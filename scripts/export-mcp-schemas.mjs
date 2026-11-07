import { format } from "prettier";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { connectMcp } from "./mcp-client.mjs";
const connection = await connectMcp(
  process.execPath,
  [resolve("dist/cli.js"), "mcp"],
  resolve("."),
);
try {
  const snapshot = {
    outputSchema: connection.tools[0].outputSchema,
    mapOutputSchema: connection.tools.find(
      (tool) => tool.name === "journeyproof_build_map",
    ).outputSchema,
    generationOutputSchema: connection.tools.find(
      (tool) => tool.name === "journeyproof_generate_test",
    ).outputSchema,
    tools: connection.tools.map(
      ({ name, description, inputSchema, annotations }) => ({
        name,
        description,
        inputSchema,
        annotations,
      }),
    ),
  };
  await writeFile(
    "docs/MCP_SCHEMAS.json",
    await format(JSON.stringify(snapshot), { parser: "json" }),
  );
} finally {
  await connection.close();
}
