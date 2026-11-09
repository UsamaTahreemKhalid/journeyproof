import { it, expect, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, type Browser } from "playwright";
import { runJourney, type RunOptions } from "../../src/index.js";
import { executeStep } from "../../src/engine/steps.js";
import { runRegression } from "../../src/regression/runtime.js";
import { toPlan } from "../../src/regression/from-journey.js";
import { MapService } from "../../src/map/service.js";
import { temp } from "../helpers.js";
import { originFixture, flow } from "./origin-fixture.js";
const source = { file: "synthetic.yaml", checksum: "a".repeat(64) };
async function fixture() {
  const files = await temp(),
    app = await originFixture();
  return {
    ...app,
    dir: files.dir,
    close: async () => {
      await app.close();
      await files.cleanup();
    },
  };
}

it.each(["/ok", "/relative", "/same/302", "/same/307", "/same/308"])(
  "preserves approved navigation and relative/same-origin redirects: %s",
  async (path) => {
    const f = await fixture();
    try {
      const { run } = await runJourney({
        journey: flow(path),
        source,
        baseUrl: f.origin,
        outputDir: f.dir,
      });
      expect(run.status).toBe("passed");
      expect(run.security).toBeUndefined();
      expect(f.forbidden).toEqual([]);
    } finally {
      await f.close();
    }
  },
);

it.each([301, 302, 303, 307, 308])(
  "blocks HTTP %i before the destination receives any request, even with allowRemote",
  async (status) => {
    const f = await fixture();
    try {
      const result = await runJourney({
        journey: flow(`/redirect/${status}`),
        source,
        baseUrl: f.origin,
        outputDir: f.dir,
        allowRemote: true,
      });
      expect(f.forbidden).toEqual([]);
      expect(result.run.status).toBe("failed");
      expect(result.run.security?.code).toBe("REDIRECT_DENIED_BEFORE_REQUEST");
      expect(result.run.steps[0]?.reason).toContain("before request dispatch");
      expect(result.run.steps[1]?.status).toBe("skipped");
      const json = await readFile(result.paths.json, "utf8");
      expect(json).not.toContain("fictional-query");
      expect(await readFile(result.paths.html, "utf8")).toContain(
        "before request dispatch",
      );
      // New optional security data remains compatible with the existing map reader.
      expect(
        (await new MapService(f.dir).build([result.run.id])).map.flows[0]
          ?.status,
      ).toBe("failed");
    } finally {
      await f.close();
    }
  },
);

it.each([
  "/chain",
  "/protocol-relative",
  "/encoded",
  "/hostname",
  "/protocol",
  "/credentials",
  "/malformed",
  "/missing",
  "/empty",
  "/scheme",
])("fails closed on redirect destination policy: %s", async (path) => {
  const f = await fixture();
  try {
    const { run } = await runJourney({
      journey: flow(path),
      source,
      baseUrl: f.origin,
      outputDir: f.dir,
    });
    expect(f.forbidden).toEqual([]);
    expect(run.status).toBe("failed");
    expect(run.security?.code).toBe(
      path === "/malformed"
        ? "BROWSER_NAVIGATION_FAILED"
        : "REDIRECT_DENIED_BEFORE_REQUEST",
    );
  } finally {
    await f.close();
  }
});

it.each([
  "/script",
  "/meta",
  "/anchor",
  "/popup",
  "/popup-redirect",
  "/popup-blank",
  "/iframe",
  "/iframe-redirect",
  "/iframe-host",
])(
  "stops real document navigation before forbidden requests: %s",
  async (path) => {
    const f = await fixture();
    let browser: Browser | undefined;
    let contextClosed = false;
    let scriptNavigationAttempted = false;
    const launch = chromium.launch.bind(chromium);
    const launchSpy =
      path === "/script"
        ? vi
            .spyOn(chromium, "launch")
            .mockImplementationOnce(async (options) => {
              browser = await launch(options);
              const newContext = browser.newContext.bind(browser);
              vi.spyOn(browser, "newContext").mockImplementationOnce(
                async (options) => {
                  const context = await newContext(options);
                  context.once("close", () => {
                    contextClosed = true;
                  });
                  const newSession = context.newCDPSession.bind(context);
                  vi.spyOn(context, "newCDPSession").mockImplementationOnce(
                    async (page) => {
                      const session = await newSession(page);
                      session.on("Fetch.requestPaused", (event) => {
                        if (
                          event.resourceType === "Document" &&
                          new URL(event.request.url).origin ===
                            f.forbiddenOrigin
                        )
                          scriptNavigationAttempted = true;
                      });
                      // Exercise the renderer ordering that exposed the unbounded DOM
                      // observation wait. This is real native interception, not a mock.
                      await session.send("Emulation.setCPUThrottlingRate", {
                        rate: 4,
                      });
                      return session;
                    },
                  );
                  return context;
                },
              );
              return browser;
            })
        : undefined;
    try {
      const journey = flow(path);
      if (path === "/anchor" || path.startsWith("/popup"))
        journey.steps.splice(1, 0, {
          id: "leave",
          action: "click",
          locator: {
            role: path === "/anchor" ? "link" : "button",
            name: path === "/anchor" ? "Leave" : "Popup",
          },
        });
      // Wait for an observable page/browser completion boundary; no sleeps to infer egress.
      const { run } = await runJourney({
        journey,
        source,
        baseUrl: f.origin,
        outputDir: f.dir,
      });
      expect(f.forbidden).toEqual([]);
      expect(run.status).toBe("failed");
      expect(run.security).toBeDefined();
      if (path === "/script") {
        expect(scriptNavigationAttempted).toBe(true);
        expect(run.security?.code).toBe("ORIGIN_BLOCKED_BEFORE_REQUEST");
        expect(run.steps[0]?.reason).toContain("before request dispatch");
        expect(run.steps[1]?.status).toBe("skipped");
        expect(JSON.stringify(run.security)).not.toContain(f.forbiddenOrigin);
        expect(contextClosed).toBe(true);
        expect(browser?.isConnected()).toBe(false);
      }
      if (path === "/popup-redirect") {
        expect(
          f.approved.filter((r) => r.path === "/redirect/302"),
        ).toHaveLength(0);
        expect(run.warnings).toContain(
          "Additional page blocked (one-page limit)",
        );
      }
    } finally {
      launchSpy?.mockRestore();
      // Also clean up after an assertion failure, without depending on runner teardown.
      await browser?.close();
      await f.close();
      expect(f.listening()).toBe(false);
    }
  },
);

it("denies direct SDK page navigation and treats late non-network commits separately", async () => {
  const f = await fixture();
  try {
    const direct = await runJourney({
      journey: flow("/ok"),
      source,
      baseUrl: f.origin,
      outputDir: f.dir,
      stepExecutor: async (page) => {
        await page.goto(f.forbiddenOrigin + "/direct");
        return "never";
      },
    });
    expect(f.forbidden).toEqual([]);
    expect(direct.run.status).toBe("failed");
    expect(direct.run.security?.code).toBe("ORIGIN_BLOCKED_BEFORE_REQUEST");
    const local = await runJourney({
      journey: flow("/ok"),
      source,
      baseUrl: f.origin,
      outputDir: f.dir,
      stepExecutor: async (page) => {
        await page.goto("about:blank");
        return "non-network document";
      },
    });
    expect(local.run.status).toBe("failed");
    expect(local.run.security?.code).toBe("NAVIGATION_DENIED_AFTER_COMMIT");
    expect(f.forbidden).toEqual([]);
  } finally {
    await f.close();
  }
});

it("preserves same-origin assets/API requests and intentionally blocks external resources and service workers", async () => {
  const f = await fixture();
  try {
    const local = await runJourney({
      journey: flow("/local-resources"),
      source,
      baseUrl: f.origin,
      outputDir: f.dir,
      stepExecutor: async (page, step, ...args) => {
        const result = await executeStep(page, step, ...args);
        if (step.id === "ready")
          expect(
            await page.evaluate(
              () =>
                (window as unknown as { fixtureAssetLoaded: boolean })
                  .fixtureAssetLoaded,
            ),
          ).toBe(true);
        return result;
      },
    });
    expect(local.run.status).toBe("passed");
    expect(f.approved.some((r) => r.path === "/asset.js")).toBe(true);
    const external = await runJourney({
      journey: flow("/external-resources"),
      source,
      baseUrl: f.origin,
      outputDir: f.dir,
    });
    expect(external.run.status).toBe("passed");
    expect(f.forbidden).toEqual([]);
    const worker = await runJourney({
      journey: flow("/sw"),
      source,
      baseUrl: f.origin,
      outputDir: f.dir,
      stepExecutor: async (page, step, ...args) => {
        const result = await executeStep(page, step, ...args);
        expect(page.context().serviceWorkers()).toHaveLength(0);
        if (step.id === "ready")
          expect(
            await page.evaluate(
              () =>
                (window as unknown as { workerAttempted: boolean })
                  .workerAttempted,
            ),
          ).toBe(true);
        return result;
      },
    });
    expect(worker.run.status).toBe("passed");
    expect(f.approved.filter((r) => r.path === "/worker.js")).toHaveLength(0);
  } finally {
    await f.close();
  }
});

it.each([302, 303, 307, 308])(
  "keeps native POST/session semantics without replay: HTTP %i",
  async (status) => {
    const f = await fixture();
    try {
      const journey = flow(`/form/${status}`);
      journey.steps.splice(1, 0, {
        id: "send",
        action: "click",
        locator: { role: "button", name: "Send" },
      });
      const { run } = await runJourney({
        journey,
        source,
        baseUrl: f.origin,
        outputDir: f.dir,
      });
      expect(run.status).toBe("passed");
      expect(f.approved.filter((r) => r.path === `/post/${status}`)).toEqual([
        { method: "POST", path: `/post/${status}` },
      ]);
      expect(f.approved.filter((r) => r.path === "/landing")).toEqual([
        { method: status >= 307 ? "POST" : "GET", path: "/landing" },
      ]);
      expect(f.sessionSeen()).toBe(true);
      expect(f.forbidden).toEqual([]);
    } finally {
      await f.close();
    }
  },
);

it("requires explicit initial-target selection and refuses disabled/invalid legacy guard options", async () => {
  const f = await fixture();
  try {
    for (const guardRedirectOrigins of [false, "false", null])
      await expect(
        runJourney({
          journey: flow("/ok"),
          source,
          baseUrl: f.origin,
          outputDir: f.dir,
          guardRedirectOrigins,
        } as RunOptions),
      ).rejects.toThrow("cannot be disabled");
    expect(f.approved).toEqual([]);
    expect(f.forbidden).toEqual([]);
    const result = await runJourney({
      journey: flow("/ok"),
      source,
      baseUrl: f.forbiddenOrigin,
      outputDir: f.dir,
      guardRedirectOrigins: true,
    });
    expect(result.run.status).toBe("passed");
    expect(f.forbidden).toEqual([{ method: "GET", path: "/ok" }]);
  } finally {
    await f.close();
  }
});

it("cancels pending navigation and bounds timeouts without hanging or destination traffic", async () => {
  const f = await fixture();
  try {
    const controller = new AbortController(),
      requested = f.requested("/slow");
    const task = runJourney({
      journey: flow("/slow"),
      source,
      baseUrl: f.origin,
      outputDir: f.dir,
      signal: controller.signal,
    });
    await requested;
    controller.abort();
    const cancelled = await task;
    expect(cancelled.run.status).toBe("failed");
    expect(cancelled.run.steps[0]?.reason).toContain("interrupted");
    expect(cancelled.run.security).toBeUndefined();
    const timeout = await runJourney({
      journey: flow("/slow"),
      source,
      baseUrl: f.origin,
      outputDir: f.dir,
      timeoutMs: 100,
    });
    const diagnostic = {
      step: timeout.run.steps[0]?.status,
      security: timeout.run.security?.code ?? "none",
      infrastructure: timeout.run.errors.some((error) =>
        /browserType\.launch.*timeout/is.test(error),
      )
        ? "browser-launch-timeout"
        : timeout.run.errors.length
          ? "other-infrastructure-error"
          : "none",
    };
    expect(timeout.run.status, JSON.stringify(diagnostic)).toBe("failed");
    expect(timeout.run.steps[0]?.reason).toMatch(/timeout/i);
    expect(timeout.run.security).toBeUndefined();
    expect(f.forbidden).toEqual([]);
  } finally {
    await f.close();
  }
});

it("keeps a short step deadline separate from slow Chromium startup", async () => {
  const f = await fixture();
  const launch = chromium.launch.bind(chromium);
  let browser: Browser | undefined;
  let startupBudget = 0;
  const delayedStartupMs = 200;
  const spy = vi
    .spyOn(chromium, "launch")
    .mockImplementationOnce(async (options) => {
      startupBudget = options?.timeout ?? 0;
      // Simulate startup exceeding the step budget without relying on machine load.
      await new Promise((resolve) => setTimeout(resolve, delayedStartupMs));
      if (startupBudget <= delayedStartupMs)
        throw new Error("Synthetic browser startup timeout");
      browser = await launch(options);
      return browser;
    });
  try {
    const { run } = await runJourney({
      journey: flow("/slow"),
      source,
      baseUrl: f.origin,
      outputDir: f.dir,
      timeoutMs: 100,
    });
    expect(startupBudget).toBeGreaterThan(delayedStartupMs);
    expect(run.status).toBe("failed");
    expect(run.steps[0]?.reason).toMatch(/timeout/i);
    expect(run.security).toBeUndefined();
    expect(f.forbidden).toEqual([]);
    expect(browser?.isConnected()).toBe(false);
  } finally {
    spy.mockRestore();
    await browser?.close();
    await f.close();
  }
});

it("preserves independent repeated/concurrent guards and generated-runtime security", async () => {
  const f = await fixture();
  try {
    const results = await Promise.all(
      ["/redirect/301", "/chain", "/ok"].map((path) =>
        runJourney({
          journey: flow(path),
          source,
          baseUrl: f.origin,
          outputDir: f.dir,
        }),
      ),
    );
    expect(results.map((r) => r.run.status)).toEqual([
      "failed",
      "failed",
      "passed",
    ]);
    const generated = await runRegression(
      toPlan(flow("/redirect/308"), source.checksum),
      executeStep,
      { env: { JP_BASE_URL: f.origin }, outputDir: f.dir },
    );
    expect(generated.run.status).toBe("failed");
    expect(generated.run.security?.code).toBe("REDIRECT_DENIED_BEFORE_REQUEST");
    expect(f.forbidden).toEqual([]);
  } finally {
    await f.close();
  }
});

it.each([301, 302, 303, 307, 308])(
  "CLI and public SDK agree on a real HTTP %i redirect with zero destination requests",
  async (status) => {
    const f = await fixture();
    try {
      await writeFile(
        join(f.dir, "flow.yaml"),
        JSON.stringify(flow(`/redirect/${status}`)),
      );
      const sdk = await runJourney({
        journey: flow(`/redirect/${status}`),
        source,
        baseUrl: f.origin,
        outputDir: f.dir,
      });
      const cli = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          import.meta.resolve("tsx"),
          resolve("src/cli/bin.ts"),
          "run",
          "--flow",
          "flow.yaml",
          "--base-url",
          f.origin,
          "--json",
        ],
        { cwd: f.dir, timeout: 15000 },
      ).catch((error) => error);
      expect(cli.code).toBe(1);
      const wire = JSON.parse(cli.stdout);
      expect(wire.run.security).toEqual(sdk.run.security);
      expect(wire.run.status).toBe("failed");
      expect(f.forbidden).toEqual([]);
    } finally {
      await f.close();
    }
  },
);

it.each(["POST", "PUT", "PATCH"])(
  "never duplicates an approved %s API request or its native 307 redirect",
  async (method) => {
    const f = await fixture();
    try {
      const { run } = await runJourney({
        journey: flow("/ok"),
        source,
        baseUrl: f.origin,
        outputDir: f.dir,
        stepExecutor: async (page, step, ...args) => {
          const observed = await executeStep(page, step, ...args);
          if (step.id === "ready")
            expect(
              await page.evaluate(
                async (method) =>
                  (await fetch("/post/307", { method, body: "synthetic" }))
                    .status,
                method,
              ),
            ).toBe(200);
          return observed;
        },
      });
      expect(run.status).toBe("passed");
      expect(f.approved.filter((r) => r.path === "/post/307")).toEqual([
        { method, path: "/post/307" },
      ]);
      expect(f.approved.filter((r) => r.path === "/landing")).toEqual([
        { method, path: "/landing" },
      ]);
      expect(f.forbidden).toEqual([]);
    } finally {
      await f.close();
    }
  },
);
it("blocks WebSockets without opening the application upgrade endpoint", async () => {
  const f = await fixture();
  try {
    const { run } = await runJourney({
      journey: flow("/ok"),
      source,
      baseUrl: f.origin,
      outputDir: f.dir,
      runTimeoutMs: 3000,
      stepExecutor: async (page, step, ...args) => {
        const observed = await executeStep(page, step, ...args);
        if (step.id === "ready")
          await page.evaluate(
            () =>
              new Promise((resolve) => {
                const socket = new WebSocket(
                  location.origin.replace("http", "ws") + "/socket",
                );
                socket.onclose = () => resolve(true);
                socket.onerror = () => resolve(true);
              }),
          );
        return observed;
      },
    });
    expect(run.status).toBe("passed");
    expect(f.upgrades()).toBe(0);
    expect(f.forbidden).toEqual([]);
  } finally {
    await f.close();
  }
});

it.each([301, 302, 303, 307, 308])(
  "does not forward or replay a POST across a forbidden HTTP %i redirect",
  async (status) => {
    const f = await fixture();
    try {
      const journey = flow(`/form-cross/${status}`);
      journey.steps.splice(1, 0, {
        id: "send",
        action: "click",
        locator: { role: "button", name: "Send" },
      });
      const { run } = await runJourney({
        journey,
        source,
        baseUrl: f.origin,
        outputDir: f.dir,
      });
      expect(run.status).toBe("failed");
      expect(run.security?.code).toBe("REDIRECT_DENIED_BEFORE_REQUEST");
      expect(
        f.approved.filter((r) => r.path === `/post-cross/${status}`),
      ).toEqual([{ method: "POST", path: `/post-cross/${status}` }]);
      expect(f.forbidden).toEqual([]);
    } finally {
      await f.close();
    }
  },
);
it("reports unavailable interception as an infrastructure error and closes the real browser before any application request", async () => {
  const f = await fixture();
  const launch = chromium.launch.bind(chromium);
  let browser: Browser | undefined;
  const spy = vi
    .spyOn(chromium, "launch")
    .mockImplementationOnce(async (options) => {
      browser = await launch(options);
      const createContext = browser.newContext.bind(browser);
      vi.spyOn(browser, "newContext").mockImplementationOnce(
        async (options) => {
          const context = await createContext(options);
          vi.spyOn(context, "newCDPSession").mockRejectedValueOnce(
            Error("Synthetic unavailable interceptor"),
          );
          return context;
        },
      );
      return browser;
    });
  try {
    const { run } = await runJourney({
      journey: flow("/ok"),
      source,
      baseUrl: f.origin,
      outputDir: f.dir,
    });
    expect(run.status).toBe("error");
    expect(run.security?.code).toBe("INTERCEPTION_UNAVAILABLE");
    expect(run.errors.join(" ")).toContain("without a routing-only fallback");
    expect(run.errors.join(" ")).not.toContain(
      "Synthetic unavailable interceptor",
    );
    expect(f.approved).toEqual([]);
    expect(f.forbidden).toEqual([]);
    expect(browser?.isConnected()).toBe(false);
  } finally {
    spy.mockRestore();
    await browser?.close();
    await f.close();
  }
});

it("keeps same-origin SPA history transitions without a second document request", async () => {
  const f = await fixture();
  try {
    const journey = flow("/spa");
    journey.steps.splice(
      1,
      0,
      {
        id: "navigate",
        action: "click",
        locator: { role: "button", name: "Navigate" },
      },
      { id: "url", action: "expectUrl", path: "/spa-done" },
    );
    const { run } = await runJourney({
      journey,
      source,
      baseUrl: f.origin,
      outputDir: f.dir,
    });
    expect(run.status).toBe("passed");
    expect(f.approved.filter((r) => r.path === "/spa-done")).toHaveLength(0);
    expect(f.forbidden).toEqual([]);
  } finally {
    await f.close();
  }
});
it("enforces the same boundary on real IPv6 loopback origins", async () => {
  const t = await temp(),
    f = await originFixture("::1");
  try {
    const normal = await runJourney({
      journey: flow("/same/302"),
      source,
      baseUrl: f.origin,
      outputDir: t.dir,
    });
    const blocked = await runJourney({
      journey: flow("/redirect/302"),
      source,
      baseUrl: f.origin,
      outputDir: t.dir,
    });
    expect(normal.run.status).toBe("passed");
    expect(blocked.run.status).toBe("failed");
    expect(blocked.run.security?.code).toBe("REDIRECT_DENIED_BEFORE_REQUEST");
    expect(f.forbidden).toEqual([]);
  } finally {
    await f.close();
    await t.cleanup();
  }
});

it("preserves legitimate same-origin iframe navigation and redirects", async () => {
  const f = await fixture();
  try {
    const { run } = await runJourney({
      journey: flow("/iframe-same"),
      source,
      baseUrl: f.origin,
      outputDir: f.dir,
      stepExecutor: async (page, step, ...args) => {
        const observed = await executeStep(page, step, ...args);
        if (step.id === "ready")
          await page
            .frameLocator("iframe")
            .getByRole("heading", { name: "Ready" })
            .waitFor({ timeout: 1000 });
        return observed;
      },
    });
    expect(run.status).toBe("passed");
    expect(run.security).toBeUndefined();
    expect(f.forbidden).toEqual([]);
  } finally {
    await f.close();
  }
});
