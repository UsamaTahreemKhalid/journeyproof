import { it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startStdio } from "../../src/mcp/stdio.js";
import { main } from "../../src/cli/main.js";
import { createJourneyProofServer } from "../../src/mcp/server.js";
import { outputSchema } from "../../src/mcp/schemas.js";
import { temp, sampleRun } from "../helpers.js";

it("owns stdio lifecycle and responds to protocol EOF and process abort without stdout logging", async () => {
  for (const abort of [false, true]) {
    const controller = new AbortController();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const serving = startStdio(controller.signal, b);
    const client = new Client({ name: "lifecycle", version: "1" });
    await client.connect(a);
    expect((await client.listTools()).tools).toHaveLength(8);
    if (abort) controller.abort();
    else await client.close();
    await serving;
    await client.close();
  }
  const controller = new AbortController();
  controller.abort();
  const io = { out: vi.fn(), err: vi.fn() };
  expect(await main(["mcp"], io, controller.signal)).toBe(0);
  expect(io.out).not.toHaveBeenCalled();
  expect(io.err).not.toHaveBeenCalled();
});
it("returns infrastructure errors truthfully and recovers from failed setup", async () => {
  const t = await temp();
  const controller = new AbortController();
  const client = new Client({ name: "error-lifecycle", version: "1" });
  let instance;
  try {
    await mkdir(join(t.dir, "flows"));
    await writeFile(
      join(t.dir, "flows/test.yaml"),
      "schemaVersion: 1\nname: test\nsteps:\n - {id: open, action: goto, path: /}",
    );
    instance = await createJourneyProofServer({
      workspaceRoot: t.dir,
      flowDirectory: "flows",
      signal: controller.signal,
      env: {},
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await instance.server.connect(b);
    await client.connect(a);
    const launch = vi
      .spyOn(chromium, "launch")
      .mockRejectedValue(new Error("private infrastructure diagnostics"));
    try {
      const result = await client.callTool({
        name: "journeyproof_run_flow",
        arguments: { flowPath: "flows/test.yaml" },
      });
      expect(result.isError).toBe(true);
      expect(outputSchema.parse(result.structuredContent).status).toBe("error");
      expect(JSON.stringify(result)).not.toContain(
        "private infrastructure diagnostics",
      );
      const doctor = await client.callTool({
        name: "journeyproof_doctor",
        arguments: {},
      });
      expect(doctor.isError).toBe(true);
    } finally {
      launch.mockRestore();
    }
    await writeFile(
      join(t.dir, "flows/secret.yaml"),
      "schemaVersion: 1\nname: test\nsteps:\n - {id: fill, action: fill, locator: {role: textbox, name: Value}, valueFromEnv: NOT_SET}",
    );
    const missing = await client.callTool({
      name: "journeyproof_run_flow",
      arguments: { flowPath: "flows/secret.yaml" },
    });
    expect(missing.isError).toBe(true);
    const id = sampleRun().id;
    await mkdir(join(t.dir, ".journeyproof/runs", id));
    await writeFile(
      join(t.dir, ".journeyproof/runs", id, "run.json"),
      JSON.stringify({ ...sampleRun(), id: "1793730000001-abcd1234" }),
    );
    expect(
      (
        await client.callTool({
          name: "journeyproof_get_report",
          arguments: { runId: id },
        })
      ).isError,
    ).toBe(true);
    controller.abort();
    expect(
      (
        await client.callTool({
          name: "journeyproof_run_flow",
          arguments: { flowPath: "flows/test.yaml" },
        })
      ).isError,
    ).toBe(true);
  } finally {
    await client.close();
    await instance?.close();
    await t.cleanup();
  }
});
