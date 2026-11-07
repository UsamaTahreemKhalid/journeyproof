import { performance } from "node:perf_hooks";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createDemo } from "../examples/admissions-demo/app/server.mjs";
import { node } from "./lib/process.mjs";
import { loadJourney, runJourney, MapService } from "../dist/index.js";
const iterations =
  process.argv.length === 2
    ? 3
    : process.argv[2] === "--iterations"
      ? Number(process.argv[3])
      : NaN;
if (
  !Number.isInteger(iterations) ||
  iterations < 2 ||
  iterations > 5 ||
  process.argv.length > 4
)
  throw Error("Use --iterations 2..5; no retries");
const report = {
  schemaVersion: 1,
  platform: process.platform,
  node: process.version,
  samples: [],
  status: "failed",
  scope:
    "Local fixed synthetic fixture; controller RSS only, not total Chromium memory; no universal latency claim",
};
const loaded = await loadJourney(
  "examples/admissions-demo/journeys/happy-path.yaml",
);
const root = resolve(".journeyproof/benchmark");
await mkdir(root, { recursive: true, mode: 0o700 });
try {
  for (let i = 0; i < iterations; i++) {
    const rssBefore = process.memoryUsage().rss;
    const browserStart = performance.now();
    const probe = await chromium.launch();
    const browserStartupMs = performance.now() - browserStart;
    let browserVersion;
    try {
      browserVersion = probe.version();
    } finally {
      await probe.close();
    }
    report.browser = browserVersion;
    const app = createDemo();
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    try {
      const origin = `http://127.0.0.1:${app.address().port}`;
      const began = performance.now();
      const result = await runJourney({
        ...loaded,
        flowPath: "examples/admissions-demo/journeys/happy-path.yaml",
        baseUrl: origin,
        outputDir: join(root, "runs"),
        guardRedirectOrigins: true,
        env: {
          JOURNEY_DEMO_EMAIL: "officer@example.test",
          JOURNEY_DEMO_PASSWORD: "fictional-demo-password",
        },
      });
      const flowWallMs = performance.now() - began;
      if (result.run.status !== "passed")
        throw Error(
          "Synthetic benchmark flow failed; preserve this failed attempt",
        );
      const reportStart = performance.now();
      await node([
        "dist/cli.js",
        "report",
        "--run",
        result.run.id,
        "--output-dir",
        join(root, "runs"),
      ]);
      const reportCommandMs = performance.now() - reportStart;
      const mapStart = performance.now();
      await new MapService(join(root, "runs")).build([result.run.id]);
      const mapMs = performance.now() - mapStart;
      report.samples.push({
        iteration: i + 1,
        runId: result.run.id,
        browserStartupMs,
        flowWallMs,
        recordedEngineMs: result.run.durationMs,
        mapMs,
        reportCommandMs,
        controllerRssBeforeBytes: rssBefore,
        controllerRssAfterBytes: process.memoryUsage().rss,
      });
    } finally {
      app.closeAllConnections();
      await new Promise((resolve) => app.close(resolve));
    }
  }
  report.summary = {};
  for (const key of [
    "browserStartupMs",
    "flowWallMs",
    "recordedEngineMs",
    "mapMs",
    "reportCommandMs",
    "controllerRssAfterBytes",
  ]) {
    const values = report.samples.map((s) => s[key]).sort((a, b) => a - b);
    const n = values.length;
    report.summary[key] = {
      n,
      median:
        n % 2
          ? values[Math.floor(n / 2)]
          : (values[n / 2 - 1] + values[n / 2]) / 2,
      min: values[0],
      max: values.at(-1),
    };
  }
  report.status = "passed";
} catch {
  report.failure =
    "An attempt failed; no automatic repeat or clean-pass reclassification.";
  process.exitCode = 1;
} finally {
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report, null, 2));
}
