/* global document */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { createDemo } from "../examples/admissions-demo/app/server.mjs";
import { connectMcp } from "./mcp-client.mjs";
const execute = promisify(execFile);
const root = resolve(".");
const env = {
  ...process.env,
  JOURNEY_DEMO_EMAIL: "officer@example.test",
  JOURNEY_DEMO_PASSWORD: "fictional-demo-password",
};
delete env.FORCE_COLOR;
async function cli(args, expectedCode = 0) {
  try {
    const result = await execute(process.execPath, ["dist/cli.js", ...args], {
      env,
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(expectedCode, 0);
    assert.equal(result.stderr, "");
    return JSON.parse(result.stdout);
  } catch (error) {
    if (expectedCode === 1 && error.code === 1) return JSON.parse(error.stdout);
    throw error;
  }
}
const manifest = {};
for (const mode of ["healthy", "broken", "reviewer"]) {
  const app = createDemo({ failApproval: mode === "broken" });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  assert(address && typeof address !== "string");
  try {
    const flow = `examples/admissions-demo/journeys/${mode === "reviewer" ? "review-guide" : "happy-path"}.yaml`;
    const run = await cli(
      [
        "run",
        "--flow",
        flow,
        "--base-url",
        `http://127.0.0.1:${address.port}`,
        "--json",
      ],
      mode === "broken" ? 1 : 0,
    );
    assert.equal(run.run.status, mode === "broken" ? "failed" : "passed");
    const map = await cli(["map", "--run", run.run.id, "--json"]);
    manifest[mode] = {
      runId: run.run.id,
      mapId: map.mapId,
      paths: map.paths,
      counts: map.summary,
    };
    console.log(JSON.stringify({ mode, ...manifest[mode] }));
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
}
const ids = [manifest.healthy.runId, manifest.broken.runId];
const comparison = await cli(["map", "--compare", ...ids, "--json"]);
assert.equal(comparison.firstDivergence, "approve-admission");
const mcp = await connectMcp(
  process.execPath,
  [join(root, "dist/cli.js"), "mcp"],
  root,
);
try {
  const built = await mcp.client.callTool({
    name: "journeyproof_build_map",
    arguments: { compareRunIds: ids },
  });
  assert.equal(built.isError, false);
  assert.equal(built.structuredContent.data.mapId, comparison.mapId);
  const fetched = await mcp.client.callTool({
    name: "journeyproof_get_map",
    arguments: { mapId: comparison.mapId, detail: 3 },
  });
  assert.equal(fetched.isError, false);
  assert.equal(
    fetched.structuredContent.data.firstDivergence,
    "approve-admission",
  );
} finally {
  await mcp.close();
}
manifest.comparison = comparison;
const dir = join(root, ".journeyproof/map-demo");
await mkdir(dir, { recursive: true, mode: 0o700 });
await writeFile(
  join(dir, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  { mode: 0o600 },
);
for (const kind of ["healthy", "broken", "comparison", "reviewer"]) {
  const map = JSON.parse(
    await readFile(join(root, manifest[kind].paths.json), "utf8"),
  );
  const html = await readFile(join(root, manifest[kind].paths.html), "utf8");
  for (const secret of [
    env.JOURNEY_DEMO_EMAIL,
    env.JOURNEY_DEMO_PASSWORD,
    "avery@example.test",
    "Avery Example",
    "fictional-query-token",
  ]) {
    assert(!JSON.stringify(map).includes(secret));
    assert(!html.includes(secret));
  }
}
console.log(
  JSON.stringify({
    comparison: comparison.mapId,
    firstDivergence: comparison.firstDivergence,
    html: comparison.paths.html,
    mcpParity: "passed",
  }),
);
const screenshotDir = join(dir, "screenshots");
await mkdir(screenshotDir, { recursive: true, mode: 0o700 });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(pathToFileURL(resolve(comparison.paths.html)).href);
  await page.waitForFunction(
    () => document.querySelectorAll("#nodes button").length > 0,
  );
  await page.screenshot({
    path: join(screenshotDir, "desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Inspect divergence" }).click();
  await page.screenshot({
    path: join(screenshotDir, "divergence.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Toggle light or dark theme" })
    .click();
  await page.screenshot({
    path: join(screenshotDir, "light.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.screenshot({
    path: join(screenshotDir, "mobile.png"),
    fullPage: true,
  });
} finally {
  await browser.close();
}
if (process.argv.includes("--open"))
  await execute(
    process.execPath,
    ["dist/cli.js", "map", "--compare", ...ids, "--open"],
    { env },
  );
