import { it, expect, vi } from "vitest";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runJourney } from "../../src/engine/run.js";
import { parseJourney, loadJourney } from "../../src/config/load.js";
import { main } from "../../src/cli/main.js";
import { temp } from "../helpers.js";

async function fixture() {
  const server = createServer((req, res) => {
    if (req.url === "/error") {
      res.writeHead(503);
      res.end("synthetic outage");
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(
      `<h1>Test page</h1><label>Value<input value="" /></label><p role="status" aria-label="Result">Hello world</p><a href="https://external.invalid/">External</a><button onclick="window.open('/popup');console.error('synthetic-secret https://local.test/a?token=abc');setTimeout(()=>{throw Error('synthetic page error')},0)">Popup</button><button onclick="fetch('/api',{method:'POST'})">Submit</button>`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No address");
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
const source = { file: "flow's.yaml", checksum: "synthetic" };
it("executes steps, captures errors, blocks popup and fails a text assertion honestly", async () => {
  const t = await temp();
  const app = await fixture();
  try {
    const journey = parseJourney(
      JSON.stringify({
        schemaVersion: 1,
        name: "Engine checks",
        steps: [
          { id: "open", action: "goto", path: "/" },
          {
            id: "fill",
            action: "fill",
            locator: { role: "textbox", name: "Value" },
            valueFromEnv: "SECRET",
          },
          {
            id: "contains",
            action: "expectText",
            locator: { role: "status", name: "Result" },
            text: "Hello",
            contains: true,
          },
          {
            id: "popup",
            action: "click",
            locator: { role: "button", name: "Popup" },
          },
          {
            id: "mismatch",
            action: "expectText",
            locator: { role: "heading", name: "Test page" },
            text: "Different",
            timeoutMs: 100,
          },
          { id: "skip", action: "goto", path: "/" },
        ],
      }),
    );
    const result = await runJourney({
      journey,
      source,
      baseUrl: app.origin,
      outputDir: t.dir,
      env: { SECRET: "synthetic-secret" },
    });
    expect(result.run.status).toBe("failed");
    expect(result.run.steps[3]?.reason).toContain("one-page journeys only");
    expect(result.run.steps[4]?.status).toBe("skipped");
    expect(result.run.steps[5]?.status).toBe("skipped");
    expect(result.run.warnings).toContain(
      "Additional page blocked (one-page limit)",
    );
    expect(result.run.errors.join(" ")).toContain("[REDACTED]");
    expect(result.run.errors.join(" ")).toContain("synthetic page error");
    const observations = JSON.parse(
      await readFile(join(t.dir, result.run.id, "observations.json"), "utf8"),
    );
    const popup = observations.events.find(
      (event: { type: string }) => event.type === "popup",
    );
    expect(popup.outcome).toBe("blocked");
    expect(popup.openerPageId).toBe("page-1");
    expect(result.run.trace).toBe("trace.zip");
    expect(result.run.steps[3]?.screenshot).toBe("failure.png");
    // Popup policy now fails the popup step. Retain the independent text-failure
    // and screenshot assertions instead of losing their original coverage.
    const mismatch = await runJourney({
      journey: {
        ...journey,
        steps: journey.steps.filter((step) => step.id !== "popup"),
      },
      source,
      baseUrl: app.origin,
      outputDir: t.dir,
      env: { SECRET: "synthetic-secret" },
    });
    expect(mismatch.run.status).toBe("failed");
    expect(
      mismatch.run.steps.find((step) => step.id === "mismatch")?.reason,
    ).toContain("Text assertion");
    expect(
      mismatch.run.steps.find((step) => step.id === "mismatch")?.screenshot,
    ).toBe("failure.png");
    expect(mismatch.run.steps.find((step) => step.id === "skip")?.status).toBe(
      "skipped",
    );
    expect(await readFile(result.paths.json, "utf8")).not.toContain(
      "synthetic-secret",
    );
  } finally {
    await app.close();
    await t.cleanup();
  }
});
it("captures same-origin HTTP error, rejects remote navigation and validates API timeouts", async () => {
  const t = await temp();
  const app = await fixture();
  try {
    const journey = parseJourney(
      JSON.stringify({
        schemaVersion: 1,
        name: "unhealthy",
        steps: [{ id: "open", action: "goto", path: "/error" }],
      }),
    );
    const result = await runJourney({
      journey,
      source,
      baseUrl: app.origin,
      outputDir: t.dir,
    });
    expect(result.run.steps[0]?.reason).toContain("HTTP 503");
    expect(result.run.http[0]?.status).toBe(503);
    await expect(
      runJourney({
        journey,
        source,
        baseUrl: app.origin,
        outputDir: t.dir,
        timeoutMs: 99,
      }),
    ).rejects.toThrow("Timeouts");
    await expect(
      runJourney({
        journey,
        source,
        baseUrl: app.origin,
        outputDir: t.dir,
        runTimeoutMs: 300001,
      }),
    ).rejects.toThrow("Timeouts");
    const external = parseJourney(
      JSON.stringify({
        schemaVersion: 1,
        name: "external",
        steps: [
          { id: "open", action: "goto", path: "/" },
          {
            id: "leave",
            action: "click",
            locator: { role: "link", name: "External" },
          },
          { id: "check", action: "expectUrl", path: "/secret", timeoutMs: 100 },
        ],
      }),
    );
    const blocked = await runJourney({
      journey: external,
      source,
      baseUrl: app.origin,
      outputDir: t.dir,
      timeoutMs: 500,
    });
    expect(blocked.run.status).toBe("failed");
    expect(blocked.run.http.every((h) => h.url.startsWith(app.origin))).toBe(
      true,
    );
  } finally {
    await app.close();
    await t.cleanup();
  }
});
it("honors cancellation and records unavailable capture without claiming pass", async () => {
  const t = await temp();
  const app = await fixture();
  try {
    const journey = parseJourney(
      JSON.stringify({
        schemaVersion: 1,
        name: "cancel",
        steps: [{ id: "open", action: "goto", path: "/" }],
      }),
    );
    const controller = new AbortController();
    controller.abort();
    const result = await runJourney({
      journey,
      source,
      baseUrl: app.origin,
      outputDir: t.dir,
      signal: controller.signal,
    });
    expect(result.run.status).toBe("failed");
    expect(result.run.steps[0]?.reason).toContain("interrupted");
  } finally {
    await app.close();
    await t.cleanup();
  }
});
it("executes the admissions CLI under coverage against a real fixture in both modes", async () => {
  // JS fixture imported dynamically; keeping demo outside the production TS build.
  const { createDemo } =
    await import("../../examples/admissions-demo/app/server.mjs");
  const t = await temp();
  const oldEmail = process.env.JOURNEY_DEMO_EMAIL;
  const oldPassword = process.env.JOURNEY_DEMO_PASSWORD;
  process.env.JOURNEY_DEMO_EMAIL = "officer@example.test";
  process.env.JOURNEY_DEMO_PASSWORD = "fictional-demo-password";
  try {
    await loadJourney("examples/admissions-demo/journeys/happy-path.yaml");
    for (const failApproval of [false, true]) {
      const app = createDemo({ failApproval });
      app.listen(0, "127.0.0.1");
      await once(app, "listening");
      const address = app.address();
      if (!address || typeof address === "string") throw Error("Address");
      try {
        const out: string[] = [];
        const code = await main(
          [
            "run",
            "--flow",
            "examples/admissions-demo/journeys/happy-path.yaml",
            "--base-url",
            `http://127.0.0.1:${address.port}`,
            "--output-dir",
            t.dir,
            "--json",
          ],
          {
            out: (s) => out.push(s),
            err: (s) => {
              throw Error(s);
            },
          },
        );
        expect(code).toBe(failApproval ? 1 : 0);
        const result = JSON.parse(out[0]!);
        expect(out).toHaveLength(1);
        expect(result.run.status).toBe(failApproval ? "failed" : "passed");
        if (failApproval)
          expect(
            result.run.steps.find(
              (s: { status: string }) => s.status === "failed",
            ).id,
          ).toBe("approve-admission");
        expect(result.run.trace).toBe("trace.zip");
        expect(
          await readFile(join(t.dir, result.run.id, "index.html"), "utf8"),
        ).not.toContain("fictional-demo-password");
      } finally {
        await new Promise<void>((resolve) => app.close(() => resolve()));
      }
    }
  } finally {
    if (oldEmail === undefined) delete process.env.JOURNEY_DEMO_EMAIL;
    else process.env.JOURNEY_DEMO_EMAIL = oldEmail;
    if (oldPassword === undefined) delete process.env.JOURNEY_DEMO_PASSWORD;
    else process.env.JOURNEY_DEMO_PASSWORD = oldPassword;
    await t.cleanup();
  }
});

it("writes an error report when browser launch fails, with no fabricated passed steps", async () => {
  const t = await temp();
  const launch = vi
    .spyOn(chromium, "launch")
    .mockRejectedValueOnce(new Error("Synthetic browser installation failure"));
  try {
    const journey = parseJourney(
      JSON.stringify({
        schemaVersion: 1,
        name: "environment failure",
        steps: [{ id: "open", action: "goto", path: "/" }],
      }),
    );
    const { run, paths } = await runJourney({
      journey,
      source,
      outputDir: t.dir,
      timeoutMs: 100,
    });
    expect(run.status).toBe("error");
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(run.steps[0]?.status).toBe("skipped");
    expect(run.errors).toContain("Synthetic browser installation failure");
    expect(run.trace).toBeUndefined();
    expect(await readFile(paths.html, "utf8")).toContain("TOOL ERROR");
  } finally {
    launch.mockRestore();
    await t.cleanup();
  }
});

it("bounds browser startup by the whole-run deadline independently of the step timeout", async () => {
  const t = await temp();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1794180000000);
  const launch = vi
    .spyOn(chromium, "launch")
    .mockRejectedValueOnce(new Error("Synthetic browser startup failure"));
  try {
    const journey = parseJourney(
      JSON.stringify({
        schemaVersion: 1,
        name: "startup budget",
        steps: [{ id: "open", action: "goto", path: "/" }],
      }),
    );
    const { run } = await runJourney({
      journey,
      source,
      outputDir: t.dir,
      timeoutMs: 100,
      runTimeoutMs: 2000,
    });
    const budget = launch.mock.calls[0]?.[0]?.timeout;
    expect(budget).toBe(2000);
    expect(run.status).toBe("error");
    expect(run.steps[0]?.status).toBe("skipped");
    expect(run.security).toBeUndefined();
  } finally {
    launch.mockRestore();
    clock.mockRestore();
    await t.cleanup();
  }
});

it("closes Chromium at the whole-run deadline and honestly reports unavailable captures", async () => {
  const t = await temp();
  const app = await fixture();
  try {
    const journey = parseJourney(
      JSON.stringify({
        schemaVersion: 1,
        name: "deadline",
        steps: [
          { id: "open", action: "goto", path: "/" },
          {
            id: "wait",
            action: "expectVisible",
            locator: { role: "heading", name: "Missing heading" },
          },
        ],
      }),
    );
    const { run } = await runJourney({
      journey,
      source,
      baseUrl: app.origin,
      outputDir: t.dir,
      runTimeoutMs: 3000,
    });
    expect(run.status).toBe("failed");
    expect(run.steps[1]?.reason).toMatch(/Timeout|timeout/);
    // Capture can finish just before the deadline closes the context. In
    // either ordering the report must accurately describe the saved evidence.
    const screenshot = run.steps[1]?.screenshot;
    if (screenshot) {
      expect(screenshot).toBe("failure.png");
      expect(
        (await readFile(join(t.dir, run.id, screenshot))).subarray(0, 8),
      ).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(run.warnings).not.toContain("Failure screenshot unavailable");
    } else {
      expect(run.warnings).toContain("Failure screenshot unavailable");
    }
    if (run.trace) {
      expect(run.trace).toBe("trace.zip");
      expect(
        (await readFile(join(t.dir, run.id, run.trace)))
          .subarray(0, 2)
          .toString(),
      ).toBe("PK");
      expect(run.warnings).not.toContain("Browser trace unavailable");
    } else {
      expect(run.warnings).toContain("Browser trace unavailable");
    }
  } finally {
    await app.close();
    await t.cleanup();
  }
});

it("reports screenshot and trace capture failures without inventing evidence", async () => {
  const t = await temp();
  try {
    const journey = parseJourney(
      JSON.stringify({
        schemaVersion: 1,
        name: "unavailable captures",
        steps: [{ id: "open", action: "goto", path: "/" }],
      }),
    );
    const { run } = await runJourney({
      journey,
      source,
      outputDir: t.dir,
      stepExecutor: async (page) => {
        vi.spyOn(page, "screenshot").mockRejectedValueOnce(
          new Error("capture failed"),
        );
        vi.spyOn(page.context().tracing, "stop").mockRejectedValueOnce(
          new Error("trace failed"),
        );
        throw new Error("synthetic step failure");
      },
    });
    expect(run.status).toBe("failed");
    expect(run.steps[0]?.screenshot).toBeUndefined();
    expect(run.trace).toBeUndefined();
    expect(run.warnings).toContain("Failure screenshot unavailable");
    expect(run.warnings).toContain("Browser trace unavailable");
  } finally {
    vi.restoreAllMocks();
    await t.cleanup();
  }
});
