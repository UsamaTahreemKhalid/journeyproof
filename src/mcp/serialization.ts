import type { CallToolResult } from "@modelcontextprotocol/server";
import { outputSchema } from "./schemas.js";
import { InputError } from "../shared/errors.js";
import { PolicyError } from "./policy.js";
export function reply(value: unknown): CallToolResult {
  const data = outputSchema.parse(value);
  if (Buffer.byteLength(JSON.stringify(data)) > 24000)
    return failure(new PolicyError("UNAVAILABLE"));
  return {
    structuredContent: data,
    content: [{ type: "text", text: JSON.stringify(data) }],
    isError: data.status === "error",
  };
}
export function failure(error: unknown): CallToolResult {
  const code =
    error instanceof PolicyError
      ? error.code
      : error instanceof InputError
        ? "INVALID_FLOW"
        : "UNAVAILABLE";
  return reply({
    status: "error",
    code,
    ...(error instanceof PolicyError && error.diagnostics
      ? { diagnostics: error.diagnostics }
      : {}),
    message: {
      PATH_DENIED:
        "Path is outside the approved journey/report scope, missing, or unsafe.",
      LOCAL_ONLY:
        "MCP supports numeric loopback origins only; remote execution is disabled.",
      BUSY: "One journey is already running in this server.",
      INVALID_FLOW:
        "Journey cannot be validated or required environment values are unavailable.",
      UNAVAILABLE:
        "Operation unavailable; report may be missing or browser/artifact access failed.",
    }[code],
    suggestion:
      "Check the approved workspace and flow root, YAML v1 schema, external environment and doctor results. Retry after any active run completes.",
  });
}
