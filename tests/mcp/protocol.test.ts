import { it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { once } from "node:events";
import {
  readdir,
  copyFile,
  mkdir,
  readFile,
  writeFile,
  symlink,
  stat,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDemo } from "../../examples/admissions-demo/app/server.mjs";
import { createJourneyProofServer } from "../../src/mcp/server.js";
import { outputSchema, summarySchema } from "../../src/mcp/schemas.js";
import { temp, sampleRun } from "../helpers.js";
const demoFlow = "examples/admissions-demo/journeys/happy-path.yaml";
const env = {
  JOURNEY_DEMO_EMAIL: "officer@example.test",
  JOURNEY_DEMO_PASSWORD: "fictional-demo-password",
};
async function harness() {
  const t = await temp();
  await mkdir(join(t.dir, "journeys"));
  await copyFile(demoFlow, join(t.dir, "journeys/admissions.yaml"));
  const instance = await createJourneyProofServer({
    workspaceRoot: t.dir,
    flowDirectory: "journeys",
    env,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await instance.server.connect(b);
  const client = new Client({
    name: "journeyproof-protocol-tests",
    version: "1",
  });
  await client.connect(a);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({
      name: "journeyproof_" + name,
      arguments: args,
    });
    const serialized = JSON.stringify(result);
    for (const secret of Object.values(env))
      expect(serialized).not.toContain(secret);
    expect(Buffer.byteLength(serialized)).toBeLessThan(50000);
    return { result, data: outputSchema.parse(result.structuredContent) };
  };
  return {
    ...t,
    instance,
    client,
    call,
    async close() {
      await client.close();
      await instance.close();
      await t.cleanup();
    },
  };
}
it("discovers all eight strict annotated tools, checks doctor and offline validation without env resolution", async () => {
  const h = await harness();
  try {
    const tools = (await h.client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "doctor",
        "get_report",
        "list_flows",
        "run_flow",
        "validate_flow",
        "build_map",
        "get_map",
        "generate_test",
      ]
        .map((t) => "journeyproof_" + t)
        .sort(),
    );
    for (const tool of tools) {
      expect(tool.description!.length).toBeGreaterThan(40);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema).toBeDefined();
    }
    expect(
      tools.find((t) => t.name.endsWith("run_flow"))!.annotations!.readOnlyHint,
    ).toBe(false);
    expect(
      tools.find((t) => t.name.endsWith("validate_flow"))!.annotations!
        .readOnlyHint,
    ).toBe(true);
    const doctor = await h.call("doctor", {
      flowPath: "journeys/admissions.yaml",
    });
    expect(doctor.data.status).toBe("ok");
    const withoutBrowser = await h.call("doctor", { checkBrowser: false });
    expect(JSON.stringify(withoutBrowser.data)).not.toContain("Chromium");
    expect(
      (await h.call("validate_flow", { flowPath: "journeys/admissions.yaml" }))
        .data.data,
    ).toEqual({
      valid: true,
      stepCount: 15,
      actions: [
        "goto",
        "fill",
        "click",
        "expectVisible",
        "expectUrl",
        "expectResponse",
        "expectText",
      ],
    });
    expect(JSON.stringify((await h.call("list_flows")).data)).toContain(
      "journeys/admissions.yaml",
    );
  } finally {
    await h.close();
  }
});
it("uses the real engine for healthy and HTTP 500 journeys sequentially and reads matching reports", async () => {
  const h = await harness();
  try {
    for (const broken of [false, true, false]) {
      const app = createDemo({ failApproval: broken });
      app.listen(0, "127.0.0.1");
      await once(app, "listening");
      const addr = app.address();
      if (!addr || typeof addr === "string") throw Error("No port");
      try {
        const { result, data } = await h.call("run_flow", {
          flowPath: "journeys/admissions.yaml",
          baseUrl: `http://127.0.0.1:${addr.port}`,
        });
        expect(result.isError).toBe(false);
        expect(data.status).toBe(broken ? "failed" : "passed");
        const run = summarySchema.parse(data.data);
        expect(run.counts).toEqual(
          broken
            ? { passed: 13, failed: 1, skipped: 1 }
            : { passed: 15, failed: 0, skipped: 0 },
        );
        if (broken) {
          expect(run.failure!.stepId).toBe("approve-admission");
          expect(run.http).toContainEqual({
            method: "POST",
            path: "/api/admissions/1/approve",
            status: 500,
          });
        }
        expect(
          run.evidence.find((e) => e.kind === "screenshot")!.available,
        ).toBe(broken);
        for (const file of run.evidence.filter((e) => e.available))
          expect((await stat(join(h.dir, file.path))).size).toBeGreaterThan(0);
        for (const file of run.evidence.filter((e) =>
          ["json", "html"].includes(e.kind),
        ))
          for (const secret of Object.values(env))
            expect(
              await readFile(join(h.dir, file.path), "utf8"),
            ).not.toContain(secret);
        const report = await h.call("get_report", { runId: run.runId });
        expect(report.data.data).toEqual(run);
        if (broken)
          expect(
            summarySchema.parse(
              (await h.call("get_report", { runId: run.runId, maxEvents: 0 }))
                .data.data,
            ).truncated,
          ).toBe(true);
      } finally {
        await new Promise<void>((resolve) => app.close(() => resolve()));
      }
    }
  } finally {
    await h.close();
  }
});
it("rejects malformed requests, unsafe paths, YAML, missing reports, remote and metadata targets", async () => {
  const h = await harness();
  const outside = await temp();
  try {
    await writeFile(
      join(h.dir, "journeys/invalid.yaml"),
      "schemaVersion: 88\nname: x\nsteps: []",
    );
    await writeFile(
      join(h.dir, "journeys/remote.yaml"),
      "schemaVersion: 1\nname: remote\nbaseUrl: https://example.com\nsteps:\n  - { id: open, action: goto, path: / }",
    );
    await writeFile(join(outside.dir, "secret.yaml"), "SECRET");
    await symlink(outside.dir, join(h.dir, "journeys/escape"));
    for (const path of [
      "../secret.yaml",
      "/etc/passwd",
      ".env",
      ".git/config",
      "journeys/escape/secret.yaml",
      "journeys/../secret.yaml",
      "journeys\\secret.yaml",
      "journeys/missing.yaml",
    ]) {
      expect(
        (await h.call("validate_flow", { flowPath: path })).result.isError,
      ).toBe(true);
    }
    expect(
      (await h.call("validate_flow", { flowPath: "journeys/invalid.yaml" }))
        .data.code,
    ).toBe("INVALID_FLOW");
    expect(
      (await h.call("run_flow", { flowPath: "journeys/invalid.yaml" })).result
        .isError,
    ).toBe(true);
    expect(
      (await h.call("get_report", { runId: sampleRun().id })).result.isError,
    ).toBe(true);
    expect(
      (await h.call("validate_flow", { flowPath: "journeys/invalid.yaml" }))
        .data.diagnostics,
    ).toEqual(
      expect.arrayContaining([
        { path: "schemaVersion", code: "invalid_value" },
      ]),
    );
    for (const baseUrl of [
      "http://localhost:4173",
      "http://169.254.169.254",
      "https://example.com",
      "http://127.0.0.1.evil.test",
      "file:///etc/passwd",
      "http://127.0.0.1:4173/path",
    ])
      expect(
        (
          await h.call("run_flow", {
            flowPath: "journeys/admissions.yaml",
            baseUrl,
          })
        ).data.code,
      ).toBe("LOCAL_ONLY");
    expect(
      (await h.call("run_flow", { flowPath: "journeys/remote.yaml" })).data
        .code,
    ).toBe("LOCAL_ONLY");
    expect(
      (
        await h.call("run_flow", {
          flowPath: "journeys/admissions.yaml",
          allowRemote: true,
        })
      ).data.code,
    ).toBe("LOCAL_ONLY");
    for (const [name, args] of [
      ["run_flow", { flowPath: demoFlow, password: "not-accepted" }],
      ["run_flow", { flowPath: demoFlow, timeoutMs: 999999 }],
      ["get_report", { runId: "../../etc/passwd" }],
      ["list_flows", { limit: 999 }],
      ["validate_flow", { flowPath: "x".repeat(1000) }],
    ] as const) {
      const invalid = await h.client.callTool({
        name: "journeyproof_" + name,
        arguments: args,
      });
      expect(invalid.isError).toBe(true);
      expect(JSON.stringify(invalid)).toContain("Invalid tool arguments");
    }
    expect(
      JSON.stringify((await h.call("list_flows", { limit: 1 })).data),
    ).toContain('"truncated":true');
    expect(
      (
        await h.call("doctor", {
          flowPath: "journeys/invalid.yaml",
          checkBrowser: false,
        })
      ).result.isError,
    ).toBe(true);
  } finally {
    await h.close();
    await outside.cleanup();
  }
});
it("denies symlinked artifact ancestors before writing and report-file symlinks", async () => {
  const h = await harness();
  const outside = await temp();
  try {
    await symlink(outside.dir, join(h.dir, ".journeyproof"));
    expect((await h.call("doctor", { checkBrowser: false })).data.code).toBe(
      "PATH_DENIED",
    );
    await rm(join(h.dir, ".journeyproof"));
    await h.call("doctor", { checkBrowser: false });
    const id = sampleRun().id;
    const runDir = join(h.dir, ".journeyproof/runs", id);
    await mkdir(runDir);
    await writeFile(join(outside.dir, "run.json"), JSON.stringify(sampleRun()));
    await symlink(join(outside.dir, "run.json"), join(runDir, "run.json"));
    expect((await h.call("get_report", { runId: id })).result.isError).toBe(
      true,
    );
  } finally {
    await h.close();
    await outside.cleanup();
  }
});
it("rejects concurrent runs and aborts the browser on shutdown", async () => {
  const h = await harness();
  try {
    await writeFile(
      join(h.dir, "journeys/wait.yaml"),
      "schemaVersion: 1\nname: wait\nsteps:\n - {id: open, action: goto, path: /login}\n - {id: wait, action: expectVisible, locator: {role: heading, name: Never appears}}",
    );
    const app = createDemo();
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const addr = app.address();
    if (!addr || typeof addr === "string") throw Error("No port");
    try {
      const pending = h.call("run_flow", {
        flowPath: "journeys/wait.yaml",
        baseUrl: `http://127.0.0.1:${addr.port}`,
      });
      const busy = await h.call("run_flow", { flowPath: "journeys/wait.yaml" });
      expect(busy.data.code).toBe("BUSY");
      expect((await h.call("doctor")).data.code).toBe("BUSY");
      // Explicit close must wait for the active engine's cleanup rather than abandon Chromium.
      await h.instance.close();
      await pending.catch(() => {});
    } finally {
      await new Promise<void>((resolve) => app.close(() => resolve()));
    }
  } finally {
    await h.close();
  }
});
it("starts the actual source executable over clean stdio and survives invalid calls", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/cli/bin.ts", "mcp"],
    cwd: resolve("."),
    stderr: "pipe",
  });
  const client = new Client(
    { name: "stdio-smoke", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  let stderr = "";
  transport.stderr?.on("data", (d) => (stderr += d));
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(8);
    expect(
      (
        await client.callTool({
          name: "journeyproof_validate_flow",
          arguments: { flowPath: 123 },
        })
      ).isError,
    ).toBe(true);
    expect(
      outputSchema.parse(
        (
          await client.callTool({
            name: "journeyproof_validate_flow",
            arguments: { flowPath: demoFlow },
          })
        ).structuredContent,
      ).status,
    ).toBe("ok");
    expect(stderr).toBe("");
  } finally {
    await client.close();
  }
});

it("terminates actual stdio children cleanly on SIGINT and SIGTERM", async () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/cli/bin.ts", "mcp"],
      cwd: resolve("."),
      stderr: "pipe",
    });
    const client = new Client({ name: "signal-check", version: "1" });
    const closed = new Promise<void>((resolve) => {
      client.onclose = resolve;
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(8);
      process.kill(transport.pid!, signal);
      await closed;
    } finally {
      await client.close();
    }
  }
});

it("propagates official client cancellation into a real browser and finishes local evidence cleanup", async () => {
  const h = await harness();
  const app = createDemo();
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const addr = app.address();
  if (!addr || typeof addr === "string") throw Error("No port");
  try {
    await writeFile(
      join(h.dir, "journeys/cancel.yaml"),
      "schemaVersion: 1\nname: cancellation\nsteps:\n - {id: open, action: goto, path: /login}\n - {id: wait, action: expectVisible, locator: {role: heading, name: Never appears}}",
    );
    const requested = once(app, "request");
    const controller = new AbortController();
    const pending = h.client
      .callTool(
        {
          name: "journeyproof_run_flow",
          arguments: {
            flowPath: "journeys/cancel.yaml",
            baseUrl: `http://127.0.0.1:${addr.port}`,
          },
        },
        { signal: controller.signal },
      )
      .catch((error) => error);
    await requested;
    controller.abort();
    expect(await pending).toBeInstanceOf(Error);
    await vi.waitFor(
      async () => {
        const ids = (await readdir(join(h.dir, ".journeyproof/runs"))).filter(
          (id) => /^\d{13}-[a-f0-9]{8}$/.test(id),
        );
        expect(ids).toHaveLength(1);
        const run = JSON.parse(
          await readFile(
            join(h.dir, ".journeyproof/runs", ids[0]!, "run.json"),
            "utf8",
          ),
        );
        expect(run.status).toBe("failed");
        expect(
          run.steps.some((step: { reason?: string }) =>
            step.reason?.includes("interrupted"),
          ),
        ).toBe(true);
        expect(
          (await readdir(join(h.dir, ".journeyproof/runs", ids[0]!))).some(
            (file) => file.startsWith(".raw"),
          ),
        ).toBe(false);
      },
      { timeout: 10000 },
    );
    expect(
      (await h.call("validate_flow", { flowPath: "journeys/admissions.yaml" }))
        .data.status,
    ).toBe("ok");
  } finally {
    await h.close();
    await new Promise<void>((r) => app.close(() => r()));
  }
});
