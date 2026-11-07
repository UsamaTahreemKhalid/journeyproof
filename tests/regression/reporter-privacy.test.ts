import { it, expect } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { emitPlaywright } from "../../src/regression/emit-playwright.js";
import { toPlan } from "../../src/regression/from-journey.js";
import type { Step } from "../../src/config/schema.js";

it("keeps unexpected page text out of live Playwright matcher errors and JSON while preserving exact/contains assertions", async () => {
  await mkdir(".journeyproof", { recursive: true });
  const dir = await mkdtemp(resolve(".journeyproof/reporter-privacy-"));
  const marker = "Ready synthetic-reporter-private-marker";
  const app = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const status =
      req.url === "/input-button"
        ? '<input type="submit" data-testid="status" value="Ready for review">'
        : req.url === "/shadow"
          ? '<div data-testid="status"></div><script>document.querySelector("[data-testid=status]").attachShadow({mode:"open"}).innerHTML="<span>Ready for review</span>";</script>'
          : req.url === "/script-child"
            ? `<div data-testid="status">Ready<script type="application/json">${marker}</script> for review</div>`
            : `<p data-testid="status">${req.url === "/private" ? marker : "  Ready\n\t for\u200b review\u00ad  "}</p>`;
    res.end(`<input aria-label="Input">${status}`);
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  if (!address || typeof address === "string") throw Error("No fixture port");
  try {
    async function spec(name: string, steps: Step[]) {
      const plan = toPlan({ schemaVersion: 1, name, steps }, "a".repeat(64));
      const code = (await emitPlaywright(plan)).replace(
        '"journeyproof/testing"',
        JSON.stringify(
          pathToFileURL(resolve("src/regression/runtime.ts")).href,
        ),
      );
      await writeFile(join(dir, name + ".spec.ts"), code);
    }
    // One positive journey retains all five compatibility assertions while
    // avoiding repeated Chromium startup and Playwright worker restarts.
    await spec("compatible-text", [
      { id: "open", action: "goto", path: "/ready" },
      {
        id: "fill",
        action: "fill",
        locator: { role: "textbox", name: "Input" },
        valueFromEnv: "JP_PRIVACY_INPUT",
      },
      {
        id: "exact",
        action: "expectText",
        locator: { testId: "status" },
        text: "Ready for review",
        timeoutMs: 250,
      },
      {
        id: "contains",
        action: "expectText",
        locator: { testId: "status" },
        text: " for\n review ",
        contains: true,
        timeoutMs: 250,
      },
      ...["input-button", "shadow", "script-child"].flatMap((path): Step[] => [
        { id: "open-" + path, action: "goto", path: "/" + path },
        {
          id: "check-" + path,
          action: "expectText",
          locator: { testId: "status" },
          text: "Ready for review",
          timeoutMs: 250,
        },
      ]),
    ]);
    for (const contains of [false, true]) {
      // The private marker starts with "Ready": exact must reject a substring,
      // and contains must reject "ready" with different case. Both also test
      // that a real received secret never enters a matcher error.
      await spec(contains ? "contains-private" : "exact-private", [
        { id: "open", action: "goto", path: "/private" },
        {
          id: "fill",
          action: "fill",
          locator: { role: "textbox", name: "Input" },
          valueFromEnv: "JP_PRIVACY_INPUT",
        },
        {
          id: "check",
          action: "expectText",
          locator: { testId: "status" },
          text: contains ? "ready" : "Ready",
          contains,
          timeoutMs: 250,
        },
      ]);
    }
    // Observe errors at the public reporter boundary, before JSON's filtering.
    // Persist only a boolean/counters: never the underlying page text/error.
    await writeFile(
      join(dir, "probe.mjs"),
      `
import { writeFileSync } from "node:fs";
export default class Probe {
  leaked = false; checks = 0; leakCategories = new Set();
  onStepEnd(test, result, step) {
    if (step.category === "expect" && step.error) this.checks++;
    if (step.error && JSON.stringify(step.error).includes(process.env.JP_PRIVACY_INPUT)) { this.leaked = true; this.leakCategories.add(step.category); }
  }
  onEnd() { writeFileSync(process.env.JP_PRIVACY_RESULT, JSON.stringify({leaked:this.leaked, checks:this.checks, leakCategories:[...this.leakCategories]})); }
}`,
    );
    await writeFile(
      join(dir, "config.mjs"),
      `export default { testDir: ${JSON.stringify(dir)}, testMatch: "*.spec.ts", workers: 1, retries: 0, reporter: [["json"], ["./probe.mjs"]], outputDir: ${JSON.stringify(join(dir, "output"))} };`,
    );
    const execute = promisify(execFile);
    let stdout: string;
    let stderr = "";
    try {
      const result = await execute(
        process.execPath,
        [
          resolve("node_modules/@playwright/test/cli.js"),
          "test",
          "--config",
          join(dir, "config.mjs"),
        ],
        {
          cwd: dir,
          env: {
            ...process.env,
            JP_BASE_URL: `http://127.0.0.1:${address.port}`,
            JP_PRIVACY_INPUT: marker,
            JP_PRIVACY_RESULT: join(dir, "probe.json"),
          },
          maxBuffer: 4 * 1024 * 1024,
          timeout: 25000,
        },
      );
      stdout = result.stdout;
      throw Error("Negative generated assertions unexpectedly passed");
    } catch (error) {
      const failure = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      expect(failure.code).toBe(1);
      stdout = failure.stdout!;
      stderr = failure.stderr ?? "";
    }
    const report = JSON.parse(stdout);
    expect(report.stats.expected).toBe(1);
    expect(report.stats.unexpected).toBe(2);
    expect(report.stats.skipped).toBe(0);
    expect(report.stats.flaky).toBe(0);
    const expected = new Map([
      ["compatible-text.spec.ts", "passed"],
      ["contains-private.spec.ts", "failed"],
      ["exact-private.spec.ts", "failed"],
    ]);
    expect(report.suites.length).toBe(expected.size);
    for (const suite of report.suites) {
      const name = basename(suite.file);
      expect(expected.has(name)).toBe(true);
      expect(suite.specs.length).toBe(1);
      expect(suite.specs[0].tests.length).toBe(1);
      const results = suite.specs[0].tests[0].results;
      expect(results.length).toBe(1);
      expect(results[0].status).toBe(expected.get(name));
      expected.delete(name);
    }
    expect(expected.size).toBe(0);
    expect(stdout.includes(marker)).toBe(false);
    expect(stderr.includes(marker)).toBe(false);
    const probe = JSON.parse(await readFile(join(dir, "probe.json"), "utf8"));
    expect(probe.checks).toBeGreaterThanOrEqual(2);
    expect(probe.leakCategories).toEqual([]);
    expect(probe.leaked).toBe(false);
  } finally {
    app.closeAllConnections();
    await new Promise<void>((resolve) => app.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
