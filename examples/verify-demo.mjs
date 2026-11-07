/* global fetch, AbortSignal */
// Executable from a locally installed tarball. No checkout paths or dev server.
import assert from "node:assert/strict";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { unzipSync, strFromU8 } from "fflate";
import { createDemo } from "./admissions-demo/app/server.mjs";
const require = createRequire(import.meta.url);
const execute = promisify(execFile);
const packageRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const bin = join(packageRoot, "dist/cli.js");
const parent = resolve(".journeyproof/installed-demo");
await mkdir(parent, { recursive: true, mode: 0o700 });
const workspace = await mkdtemp(join(parent, "demo-"));
await cp(
  join(packageRoot, "examples/admissions-demo"),
  join(workspace, "examples/admissions-demo"),
  { recursive: true, errorOnExist: true, force: false },
);
await writeFile(
  join(workspace, "package.json"),
  JSON.stringify({ type: "module" }),
  { mode: 0o600 },
);
const env = {
  ...process.env,
  JOURNEYPROOF_WORKSPACE_ROOT: workspace,
  JOURNEYPROOF_FLOW_ROOT: "examples/admissions-demo/journeys",
  JOURNEY_DEMO_EMAIL: "officer@example.test",
  JOURNEY_DEMO_PASSWORD: "fictional-demo-password",
};
delete env.FORCE_COLOR;
const secrets = [
  env.JOURNEY_DEMO_EMAIL,
  env.JOURNEY_DEMO_PASSWORD,
  "Avery Example",
  "avery@example.test",
  "fictional-query-token",
];
async function cli(args, expected = 0) {
  let output;
  try {
    output = await execute(process.execPath, [bin, ...args], {
      cwd: workspace,
      env,
      timeout: 90000,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(expected, 0);
  } catch (error) {
    if (error.code !== expected || expected === 0) throw error;
    output = error;
  }
  assert.equal(output.stderr, "");
  return JSON.parse(output.stdout);
}
async function fixture(failApproval, task) {
  const app = createDemo({ failApproval });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  try {
    const origin = `http://127.0.0.1:${app.address().port}`;
    assert.equal(
      (await fetch(origin + "/health", { signal: AbortSignal.timeout(5000) }))
        .status,
      200,
    );
    return await task(origin);
  } finally {
    app.closeAllConnections();
    await new Promise((resolve) => app.close(resolve));
  }
}
const flow = "examples/admissions-demo/journeys/happy-path.yaml";
const source = await fixture(false, (origin) =>
  cli(["run", "--flow", flow, "--base-url", origin, "--json"]),
);
assert.equal(source.run.status, "passed");
const spec = "tests/generated/admissions.spec.ts";
const generation = await cli([
  "generate-test",
  "--run",
  source.run.id,
  "--out",
  spec,
  "--json",
]);
assert.equal(generation.eligible, true);
assert.equal(generation.written, true);
const code = await readFile(join(workspace, spec), "utf8");
for (const secret of secrets) assert(!code.includes(secret));
const bindings = generation.requiredEnv;
assert.equal(bindings.length, 4);
env[bindings[2]] = "Avery Example";
env[bindings[3]] = "avery@example.test";
const manifest = {
  schemaVersion: 1,
  workspace,
  packageRoot,
  sourceRunId: source.run.id,
  flow,
  spec,
  requiredEnv: bindings,
};
for (const broken of [false, true]) {
  const mode = broken ? "broken" : "healthy";
  manifest[mode] = await fixture(broken, async (origin) => {
    const root = join(workspace, ".journeyproof/runs");
    const before = new Set(await readdir(root));
    let result,
      codeStatus = 0;
    try {
      result = await execute(
        process.execPath,
        [
          require.resolve("@playwright/test/cli"),
          "test",
          "--config",
          join(packageRoot, "examples/ci/regression.config.mjs"),
        ],
        {
          cwd: workspace,
          env: {
            ...env,
            JP_BASE_URL: origin,
            JP_SPEC_NAME: "admissions.spec.ts",
            JP_DEMO_WORKSPACE: workspace,
          },
          timeout: 90000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
    } catch (error) {
      if (error.code !== 1) throw error;
      result = error;
      codeStatus = 1;
    }
    assert.equal(codeStatus, broken ? 1 : 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.stats.expected, broken ? 0 : 1);
    assert.equal(report.stats.unexpected, broken ? 1 : 0);
    assert.equal(report.stats.skipped, 0);
    assert.equal(report.stats.flaky, 0);
    const added = (await readdir(root)).filter(
      (id) => !before.has(id) && /^\d{13}-[a-f0-9]{8}$/.test(id),
    );
    assert.equal(added.length, 1);
    const id = added[0];
    const run = JSON.parse(await readFile(join(root, id, "run.json"), "utf8"));
    assert.equal(run.status, broken ? "failed" : "passed");
    if (broken) {
      const failed = run.steps.find((s) => s.status === "failed");
      assert.equal(failed.id, "approve-admission");
      assert.match(failed.reason, /Expected HTTP 200; observed HTTP 500/);
      for (const file of [
        "failure.png",
        "trace.zip",
        "index.html",
        "observations.json",
      ])
        assert((await readFile(join(root, id, file))).length > 0);
    }
    const map = await cli(["map", "--run", id, "--json"]);
    const html = await readFile(join(root, id, "index.html"), "utf8");
    const traceText = Object.values(
      unzipSync(await readFile(join(root, id, "trace.zip"))),
    )
      .map((value) => strFromU8(value))
      .join("\n");
    for (const secret of secrets) {
      assert(!result.stdout.includes(secret));
      assert(!traceText.includes(secret));
      assert(!JSON.stringify(run).includes(secret));
      assert(!html.includes(secret));
      assert(
        !(await readFile(join(workspace, map.paths.json), "utf8")).includes(
          secret,
        ),
      );
    }
    return {
      runId: id,
      status: run.status,
      runnerExitCode: codeStatus,
      report: relative(workspace, join(root, id, "index.html")),
      json: relative(workspace, join(root, id, "run.json")),
      trace: relative(workspace, join(root, id, "trace.zip")),
      ...(broken
        ? {
            screenshot: relative(workspace, join(root, id, "failure.png")),
            failure: "Expected HTTP 200; observed HTTP 500",
          }
        : {}),
      map: map.paths.html,
    };
  });
  assert.equal(await readFile(join(workspace, spec), "utf8"), code);
}
const comparison = await cli([
  "map",
  "--compare",
  manifest.healthy.runId,
  manifest.broken.runId,
  "--json",
]);
assert.equal(comparison.firstDivergence, "approve-admission");
manifest.comparison = comparison.paths.html;
manifest.coverage = await cli([
  "coverage",
  "--flow",
  flow,
  "--runs",
  manifest.healthy.runId + "," + manifest.broken.runId,
  "--format",
  "json",
]);
// Use the installed browser library to exercise the installed static viewer via file://.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const external = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) external.push(r.url());
  });
  await page.goto(pathToFileURL(join(workspace, manifest.comparison)).href);
  await page
    .locator("#divergence")
    .filter({ hasText: "approve admission" })
    .waitFor();
  await page.getByRole("button", { name: "Inspect divergence" }).click();
  assert.match(
    await page.locator("#detail-content").innerText(),
    /Expected HTTP 200; observed HTTP 500/,
  );
  await page.getByRole("button", { name: "Preview screenshot" }).click();
  await page.locator("#detail-content img").waitFor();
  assert.equal(
    await page
      .locator("#detail-content img")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );
  assert.equal((await page.locator("[data-node-id]").count()) > 0, true);
  assert.equal(external.length, 0);
  await page.screenshot({
    path: join(workspace, "comparison.png"),
    fullPage: true,
  });
  manifest.viewer = {
    loaded: true,
    externalRequests: 0,
    screenshot: "comparison.png",
  };
} finally {
  await browser.close();
}
await writeFile(
  join(workspace, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(manifest));
