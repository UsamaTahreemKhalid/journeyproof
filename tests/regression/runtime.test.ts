import { it, expect } from "vitest";
import { once } from "node:events";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { runRegression } from "../../src/regression/runtime.js";
import { executeStep } from "../../src/engine/steps.js";
import { toPlan } from "../../src/regression/from-journey.js";
import { createDemo } from "../../examples/admissions-demo/app/server.mjs";
import { journeySchema } from "../../src/config/schema.js";
import { temp } from "../helpers.js";
import { journey, checksum } from "./fixtures.js";
it("fails before browser launch for invalid plans, unsafe origins and missing/unsafe input values", async () => {
  const plan = toPlan(journey, checksum);
  await expect(runRegression({}, executeStep)).rejects.toThrow("Invalid");
  await expect(runRegression(plan, executeStep, { env: {} })).rejects.toThrow(
    "JP_BASE_URL",
  );
  for (const origin of [
    "http://localhost:4173",
    "http://example.test",
    "http://127.0.0.1/?token=secret",
    "http://127.0.0.1.evil.test",
  ])
    await expect(
      runRegression(plan, executeStep, { env: { JP_BASE_URL: origin } }),
    ).rejects.toThrow();
  for (const value of [undefined, "ab", "passed"])
    await expect(
      runRegression(plan, executeStep, {
        env: { JP_BASE_URL: "http://127.0.0.1:4173", DEMO_EMAIL: value },
      }),
    ).rejects.toThrow("DEMO_EMAIL");
});
it("delegates generated callbacks to the existing engine with real reports, observations and cancellation", async () => {
  const t = await temp();
  const app = createDemo();
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  try {
    const address = app.address();
    if (!address || typeof address === "string") throw Error();
    const plan = toPlan(
      journeySchema.parse({
        schemaVersion: 1,
        name: "Local",
        steps: [
          { id: "open", action: "goto", path: "/login" },
          {
            id: "fill",
            action: "fill",
            locator: { role: "textbox", name: "Email" },
            valueFromEnv: "EMAIL",
          },
          {
            id: "visible",
            action: "expectVisible",
            locator: { role: "heading", name: "Sign in" },
          },
        ],
      }),
      checksum,
    );
    const env = {
      JP_BASE_URL: `http://127.0.0.1:${address.port}`,
      EMAIL: "synthetic@example.test",
    };
    const called: string[] = [];
    const result = await runRegression(
      plan,
      async (...args) => {
        called.push(args[1].id);
        return executeStep(...args);
      },
      { env, outputDir: t.dir },
    );
    expect(result.run.status).toBe("passed");
    expect(called).toEqual(["open", "fill", "visible"]);
    expect(await readFile(result.paths.json, "utf8")).not.toContain(env.EMAIL);
    expect(
      JSON.parse(
        await readFile(join(t.dir, result.run.id, "observations.json"), "utf8"),
      ).events.some((e: { type: string }) => e.type === "step"),
    ).toBe(true);
    const cancelled = await runRegression(plan, executeStep, {
      env,
      outputDir: t.dir,
      signal: AbortSignal.abort(),
    });
    expect(cancelled.run.status).toBe("failed");
    expect(cancelled.run.steps[0]!.reason).toContain("interrupted");
  } finally {
    app.closeAllConnections();
    await new Promise<void>((resolve) => app.close(() => resolve()));
    await t.cleanup();
  }
});
