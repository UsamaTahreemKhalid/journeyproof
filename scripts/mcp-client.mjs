import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export async function connectMcp(command, args, workspaceRoot, extraEnv = {}) {
  const transport = new StdioClientTransport({
    command,
    args,
    cwd: workspaceRoot,
    env: {
      ...process.env,
      ...extraEnv,
      JOURNEYPROOF_WORKSPACE_ROOT: workspaceRoot,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "journeyproof-local-smoke", version: "1" });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => (stderr += chunk));
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 8);
    return {
      client,
      tools,
      async close() {
        await client.close();
        assert.equal(
          stderr,
          "",
          "MCP stderr must be clean in normal operation",
        );
      },
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
