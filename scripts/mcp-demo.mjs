import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDemo } from "../examples/admissions-demo/app/server.mjs";
import { connectMcp } from "./mcp-client.mjs";

const workspace = resolve(".");
const flowPath = "examples/admissions-demo/journeys/happy-path.yaml";
const env = {
  JOURNEY_DEMO_EMAIL: "officer@example.test",
  JOURNEY_DEMO_PASSWORD: "fictional-demo-password",
};
const connection = await connectMcp(
  process.execPath,
  [join(workspace, "dist/cli.js"), "mcp"],
  workspace,
  env,
);
try {
  console.log(
    "MCP tools:",
    connection.tools.map((tool) => tool.name).join(", "),
  );
  for (const failApproval of [false, true]) {
    const app = createDemo({ failApproval });
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    assert(address && typeof address !== "string");
    try {
      const result = await connection.client.callTool({
        name: "journeyproof_run_flow",
        arguments: { flowPath, baseUrl: `http://127.0.0.1:${address.port}` },
      });
      assert.equal(result.isError, false);
      const report = result.structuredContent;
      assert.equal(report.status, failApproval ? "failed" : "passed");
      assert.deepEqual(
        report.data.counts,
        failApproval
          ? { passed: 13, failed: 1, skipped: 1 }
          : { passed: 15, failed: 0, skipped: 0 },
      );
      const fetched = await connection.client.callTool({
        name: "journeyproof_get_report",
        arguments: { runId: report.data.runId },
      });
      assert.deepEqual(fetched.structuredContent, report);
      for (const evidence of report.data.evidence.filter(
        (item) => item.available,
      ))
        assert((await stat(join(workspace, evidence.path))).size > 0);
      for (const evidence of report.data.evidence.filter((item) =>
        ["json", "html"].includes(item.kind),
      )) {
        const text = await readFile(join(workspace, evidence.path), "utf8");
        for (const secret of Object.values(env)) assert(!text.includes(secret));
      }
      for (const secret of Object.values(env))
        assert(!JSON.stringify(result).includes(secret));
      const output = join(workspace, ".journeyproof/mcp-demo");
      await mkdir(output, { recursive: true, mode: 0o700 });
      await writeFile(
        join(output, failApproval ? "broken.json" : "healthy.json"),
        JSON.stringify(report, null, 2) + "\n",
        { mode: 0o600 },
      );
      console.log(
        JSON.stringify({
          runId: report.data.runId,
          status: report.status,
          counts: report.data.counts,
          ...(report.data.failure
            ? { failure: report.data.failure, http: report.data.http }
            : {}),
        }),
      );
    } finally {
      await new Promise((resolve) => app.close(resolve));
    }
  }
} finally {
  await connection.close();
}
