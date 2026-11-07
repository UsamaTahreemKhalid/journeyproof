import { once } from "node:events";
import { copyFile } from "node:fs/promises";
import { createDemo } from "../../examples/admissions-demo/app/server.mjs";
import { outputSchema } from "../../src/mcp/schemas.js";
import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { createJourneyProofServer } from "../../src/mcp/server.js";
import { generationOutput } from "../../src/mcp/regression.js";
import { main } from "../../src/cli/main.js";
import { workspace, source, saveSource } from "./fixtures.js";
it("serves bounded previews and explicit confined writes via a real SDK client", async () => {
  const t = await workspace();
  const app = await createJourneyProofServer({
    workspaceRoot: t.dir,
    flowDirectory: "flows",
  });
  const client = new Client({ name: "regression", version: "1" });
  try {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await app.server.connect(b);
    await client.connect(a);
    const tools = (await client.listTools()).tools;
    expect(tools).toHaveLength(8);
    expect(
      tools.find((t) => t.name === "journeyproof_generate_test")!.annotations!
        .readOnlyHint,
    ).toBe(false);
    const call = async (args: Record<string, unknown>) =>
      client.callTool({ name: "journeyproof_generate_test", arguments: args });
    const preview = generationOutput.parse(
      (await call({ flowPath: "flows/test.yaml" })).structuredContent,
    );
    expect(preview.data).toMatchObject({
      eligible: true,
      written: false,
      diagnostics: ["DEFINITION_ONLY"],
    });
    expect(JSON.stringify(preview)).not.toContain("private-literal");
    expect(JSON.stringify(preview)).not.toContain(t.dir);
    await expect(access(join(t.dir, "tests"))).rejects.toThrow();
    for (const args of [
      {},
      { runId: "../../etc/passwd" },
      { flowPath: "flows/test.yaml", runId: "1793730000000-abcd1234" },
      {
        flowPath: "flows/test.yaml",
        dryRun: false,
        outPath: "tests/generated/a.spec.ts",
      },
      { flowPath: "flows/test.yaml", dryRun: false, approveWrite: true },
      { flowPath: "flows/test.yaml", force: true },
    ])
      expect((await call(args)).isError).toBe(true);
    const args = {
      flowPath: "flows/test.yaml",
      outPath: "tests/generated/a.spec.ts",
      dryRun: false,
      approveWrite: true,
    };
    const written = await call(args);
    expect(written.isError).toBe(false);
    expect(
      generationOutput.parse(written.structuredContent).data!.written,
    ).toBe(true);
    const path = join(t.dir, "tests/generated/a.spec.ts");
    expect(await readFile(path, "utf8")).toBe(preview.data!.preview);
    await writeFile(path, "// custom");
    expect((await call(args)).isError).toBe(true);
    expect((await call({ ...args, outPath: "src/a.spec.ts" })).isError).toBe(
      true,
    );
    const s = source();
    await saveSource(t.dir, s, t.hash);
    expect(
      generationOutput.parse(
        (await call({ runId: s.run.id })).structuredContent,
      ).data!.source.mode,
    ).toBe("verified-run");
  } finally {
    await client.close();
    await app.close();
    await t.cleanup();
  }
});
it("CLI previews/writes and reports table/JSON coverage with predictable exit codes", async () => {
  const t = await workspace();
  const previous = {
    root: process.env.JOURNEYPROOF_WORKSPACE_ROOT,
    flows: process.env.JOURNEYPROOF_FLOW_ROOT,
  };
  process.env.JOURNEYPROOF_WORKSPACE_ROOT = t.dir;
  process.env.JOURNEYPROOF_FLOW_ROOT = "flows";
  const output: string[] = [],
    errors: string[] = [];
  const io = {
    out: (s: string) => output.push(s),
    err: (s: string) => errors.push(s),
  };
  try {
    expect(
      await main(
        ["generate-test", "--flow", "flows/test.yaml", "--dry-run", "--json"],
        io,
      ),
    ).toBe(0);
    expect(JSON.parse(output.pop()!).written).toBe(false);
    expect(
      await main(
        [
          "generate-test",
          "--flow",
          "flows/test.yaml",
          "--out",
          "tests/generated/cli.spec.ts",
        ],
        io,
      ),
    ).toBe(0);
    expect(await main(["generate-test", "--json"], io)).toBe(2);
    expect(JSON.parse(output.pop()!).status).toBe("error");
    const s = source();
    await saveSource(t.dir, s, t.hash);
    expect(
      await main(
        [
          "coverage",
          "--flow",
          "flows/test.yaml",
          "--runs",
          s.run.id,
          "--format",
          "table",
        ],
        io,
      ),
    ).toBe(0);
    expect(output.pop()).toContain("executed assertions 4/8");
    expect(
      await main(
        [
          "coverage",
          "--flow",
          "flows/test.yaml",
          "--runs",
          s.run.id,
          "--format",
          "json",
        ],
        io,
      ),
    ).toBe(0);
    expect(JSON.parse(output.pop()!).runs[0].passed).toBe(4);
    for (const args of [
      ["coverage"],
      [
        "coverage",
        "--flow",
        "flows/test.yaml",
        "--runs",
        s.run.id,
        "--format",
        "xml",
      ],
      [
        "coverage",
        "--flow",
        "flows/test.yaml",
        "--runs",
        Array.from({ length: 21 }, () => s.run.id).join(","),
      ],
    ])
      expect(await main(args, io)).toBe(2);
  } finally {
    if (previous.root === undefined)
      delete process.env.JOURNEYPROOF_WORKSPACE_ROOT;
    else process.env.JOURNEYPROOF_WORKSPACE_ROOT = previous.root;
    if (previous.flows === undefined) delete process.env.JOURNEYPROOF_FLOW_ROOT;
    else process.env.JOURNEYPROOF_FLOW_ROOT = previous.flows;
    await t.cleanup();
  }
});

it("links an actual MCP-run flow inside a non-cwd approved workspace for verified generation", async () => {
  const t = await workspace();
  await copyFile(
    "examples/admissions-demo/journeys/happy-path.yaml",
    join(t.dir, "flows/test.yaml"),
  );
  const instance = await createJourneyProofServer({
    workspaceRoot: t.dir,
    flowDirectory: "flows",
    env: {
      JOURNEY_DEMO_EMAIL: "officer@example.test",
      JOURNEY_DEMO_PASSWORD: "fictional-demo-password",
    },
  });
  const app = createDemo();
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const client = new Client({ name: "real-regression-source", version: "1" });
  try {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await instance.server.connect(b);
    await client.connect(a);
    const address = app.address();
    if (!address || typeof address === "string") throw Error();
    const run = outputSchema.parse(
      (
        await client.callTool({
          name: "journeyproof_run_flow",
          arguments: {
            flowPath: "flows/test.yaml",
            baseUrl: `http://127.0.0.1:${address.port}`,
          },
        })
      ).structuredContent,
    );
    expect(run.status).toBe("passed");
    if (!run.data || !("runId" in run.data)) throw Error("Missing run ID");
    const response = await client.callTool({
      name: "journeyproof_generate_test",
      arguments: { runId: run.data.runId },
    });
    expect(response.isError).toBe(false);
    expect(
      generationOutput.parse(response.structuredContent).data,
    ).toMatchObject({
      eligible: true,
      steps: 15,
      assertions: 7,
      source: { mode: "verified-run", runId: run.data.runId },
    });
  } finally {
    await client.close();
    await instance.close();
    app.closeAllConnections();
    await new Promise<void>((resolve) => app.close(() => resolve()));
    await t.cleanup();
  }
});
