/* global fetch, AbortSignal */
import assert from "node:assert/strict";
import { once } from "node:events";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, relative, join, basename } from "node:path";
import ts from "typescript";
import { unzipSync, strFromU8 } from "fflate";
import { createDemo } from "../examples/admissions-demo/app/server.mjs";
import { loadJourney, runJourney, MapService } from "../dist/index.js";
import { connectMcp } from "./mcp-client.mjs";
const execute = promisify(execFile);
const root = resolve(".");
const dir = ".journeyproof/regression-demo";
await mkdir(dir, { recursive: true, mode: 0o700 });
const flowPath = "examples/admissions-demo/journeys/happy-path.yaml";
const loaded = await loadJourney(flowPath);
const env = {
  ...process.env,
  JOURNEY_DEMO_EMAIL: "officer@example.test",
  JOURNEY_DEMO_PASSWORD: "fictional-demo-password",
};
delete env.FORCE_COLOR;
async function fixture(broken, task, privateStatus = false) {
  const server = createDemo({ failApproval: broken });
  if (privateStatus) {
    // Synthetic security negative: expose a configured secret as unexpected status text.
    // Override only this disposable server; never change application files.
    const handler = server.listeners("request")[0];
    server.removeAllListeners("request");
    server.on("request", (request, response) => {
      if (request.url === "/client.js") {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end(
          `const button=document.querySelector('[data-approve]');button.addEventListener('click',async()=>{await fetch(button.dataset.approve,{method:'POST'});document.querySelector('[role=status]').textContent=${JSON.stringify(env.JOURNEY_DEMO_PASSWORD)};});`,
        );
      } else handler(request, response);
    });
  }
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal(
      (await fetch(origin + "/login", { signal: AbortSignal.timeout(5000) }))
        .status,
      200,
    );
    return await task(origin);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
async function cli(args) {
  const result = await execute(process.execPath, ["dist/cli.js", ...args], {
    env,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}
const source = await fixture(false, (origin) =>
  runJourney({
    ...loaded,
    flowPath,
    baseUrl: origin,
    env,
    guardRedirectOrigins: true,
  }),
);
assert.equal(source.run.status, "passed");
const generatedPath = `tests/generated/admissions-${source.run.id}.spec.ts`;
const generated = await cli([
  "generate-test",
  "--run",
  source.run.id,
  "--out",
  generatedPath,
  "--json",
]);
assert.equal(generated.eligible, true);
assert.equal(generated.written, true);
const code = await readFile(generatedPath, "utf8");
for (const value of [
  ...Object.values(env).filter(
    (v) => v === env.JOURNEY_DEMO_EMAIL || v === env.JOURNEY_DEMO_PASSWORD,
  ),
  "Avery Example",
  "avery@example.test",
])
  assert(!code.includes(value));
loaded.journey.steps
  .filter((step) => step.action === "fill")
  .forEach((step, index) => {
    if (step.value !== undefined)
      env[generated.requiredEnv[index]] = step.value;
  });
// Typecheck the actual emitted file after build, including installed self-package exports.
const program = ts.createProgram([resolve(generatedPath)], {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
});
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(
  diagnostics.length,
  0,
  ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  }),
);
const manifest = {
  sourceRunId: source.run.id,
  flowPath,
  generatedPath,
  requiredEnv: generated.requiredEnv,
};
for (const mode of ["healthy", "broken", "privateStatus"]) {
  manifest[mode] = await fixture(
    mode === "broken",
    async (origin) => {
      const before = new Set(await readdir(".journeyproof/runs"));
      let output,
        exitCode = 0;
      try {
        output = await execute(
          process.execPath,
          [
            "node_modules/@playwright/test/cli.js",
            "test",
            "--config",
            "regression.playwright.config.ts",
          ],
          {
            env: {
              ...env,
              JP_BASE_URL: origin,
              JP_SPEC_NAME: basename(generatedPath),
            },
            maxBuffer: 8 * 1024 * 1024,
            timeout: 90000,
          },
        );
      } catch (error) {
        if (error.code !== 1) throw error;
        exitCode = 1;
        output = error;
      }
      assert.equal(exitCode, mode === "healthy" ? 0 : 1);
      const report = JSON.parse(output.stdout);
      assert.equal(report.stats.expected, mode === "healthy" ? 1 : 0);
      assert.equal(report.stats.unexpected, mode === "healthy" ? 0 : 1);
      assert.equal(report.stats.skipped, 0);
      assert.equal(report.stats.flaky, 0);
      const added = (await readdir(".journeyproof/runs")).filter(
        (id) => !before.has(id) && /^\d{13}-[a-f0-9]{8}$/.test(id),
      );
      assert.equal(added.length, 1);
      const runId = added[0];
      const run = JSON.parse(
        await readFile(`.journeyproof/runs/${runId}/run.json`, "utf8"),
      );
      assert.equal(run.status, mode === "healthy" ? "passed" : "failed");
      if (mode !== "healthy") {
        assert.equal(
          run.steps.find((s) => s.status === "failed").id,
          mode === "broken" ? "approve-admission" : "check-approved",
        );
        assert.match(
          run.steps.find((s) => s.status === "failed").reason,
          mode === "broken"
            ? /Expected HTTP 200; observed HTTP 500/
            : /Configured expectText failed/,
        );
        for (const artifact of [
          "failure.png",
          "trace.zip",
          "index.html",
          "observations.json",
        ])
          assert(
            (await readFile(`.journeyproof/runs/${runId}/${artifact}`)).length >
              0,
          );
      }
      const map = await new MapService().build([runId]);
      const traceText = Object.entries(
        unzipSync(await readFile(`.journeyproof/runs/${runId}/trace.zip`)),
      )
        .map(([, value]) => strFromU8(value))
        .join("\n");
      const html = await readFile(
        `.journeyproof/runs/${runId}/index.html`,
        "utf8",
      );
      // Raw reporter output is inspected in memory, never saved/uploaded.
      for (const secret of [
        env.JOURNEY_DEMO_EMAIL,
        env.JOURNEY_DEMO_PASSWORD,
        "Avery Example",
        "avery@example.test",
        "fictional-query-token",
      ]) {
        assert(!output.stdout.includes(secret));
        assert(!traceText.includes(secret));
        assert(!html.includes(secret));
        assert(!JSON.stringify(run).includes(secret));
        assert(!(await readFile(map.paths.json, "utf8")).includes(secret));
      }
      return {
        runId,
        runnerExitCode: exitCode,
        status: run.status,
        report: `.journeyproof/runs/${runId}/index.html`,
        json: `.journeyproof/runs/${runId}/run.json`,
        trace: `.journeyproof/runs/${runId}/trace.zip`,
        ...(mode !== "healthy"
          ? {
              screenshot: `.journeyproof/runs/${runId}/failure.png`,
              failure:
                mode === "broken"
                  ? "Expected HTTP 200; observed HTTP 500"
                  : "Configured expectText failed",
            }
          : {}),
        map: relative(root, map.paths.html),
      };
    },
    mode === "privateStatus",
  );
  assert.equal(
    await readFile(generatedPath, "utf8"),
    code,
    "Same generated file must be executed twice",
  );
}
const comparison = await new MapService().build([
  manifest.healthy.runId,
  manifest.broken.runId,
]);
assert.equal(comparison.map.comparison.firstDivergence, "approve-admission");
manifest.comparison = relative(root, comparison.paths.html);
manifest.coverage = await cli([
  "coverage",
  "--flow",
  flowPath,
  "--runs",
  `${manifest.healthy.runId},${manifest.broken.runId}`,
  "--format",
  "json",
]);
const mcp = await connectMcp(
  process.execPath,
  [join(root, "dist/cli.js"), "mcp"],
  root,
);
try {
  const response = await mcp.client.callTool({
    name: "journeyproof_generate_test",
    arguments: { runId: source.run.id },
  });
  assert.equal(response.isError, false);
  assert.equal(response.structuredContent.data.preview, generated.preview);
  manifest.mcp = {
    status: response.structuredContent.status,
    eligible: response.structuredContent.data.eligible,
    steps: response.structuredContent.data.steps,
    assertions: response.structuredContent.data.assertions,
    written: response.structuredContent.data.written,
  };
} finally {
  await mcp.close();
}
await writeFile(
  `${dir}/failure.png`,
  await readFile(manifest.broken.screenshot),
  { mode: 0o600 },
);
await writeFile(
  `${dir}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(manifest, null, 2));
