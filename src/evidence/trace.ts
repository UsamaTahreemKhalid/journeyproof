import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { redactObject } from "../shared/safety.js";
import { InputError } from "../shared/errors.js";
import { readFile, stat } from "node:fs/promises";

const LIMIT = 12 * 1024 * 1024;
export async function readSanitizedTrace(file: string, secrets: string[]) {
  if ((await stat(file)).size > LIMIT)
    throw new InputError("Trace exceeds 12 MiB evidence limit");
  return sanitizeTrace(await readFile(file), secrets);
}
// Only operation records survive. No resource files, network headers/bodies,
// DOM snapshots, screenshots, sources, cookies or storage are retained.
export function sanitizeTrace(raw: Uint8Array, secrets: string[]): Uint8Array {
  if (raw.byteLength > LIMIT)
    throw new InputError("Trace exceeds 12 MiB evidence limit");
  const output: Record<string, Uint8Array> = {};
  const entries = unzipSync(raw, {
    filter: (file) =>
      file.name.endsWith(".trace") && file.originalSize <= LIMIT,
  });
  for (const [name, bytes] of Object.entries(entries)) {
    const lines = strFromU8(bytes)
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const record = JSON.parse(line) as Record<string, unknown>;
        if (
          record.type === "console" ||
          record.type === "event" ||
          record.type === "input"
        )
          return "";
        if (record.type === "after") delete record.result;
        if (record.type === "before") {
          const params = record.params as Record<string, unknown> | undefined;
          if (params)
            for (const key of [
              "value",
              "text",
              "expression",
              "arg",
              "headers",
              "postData",
            ])
              if (key in params) params[key] = "[REDACTED]";
        }
        return JSON.stringify(redactObject(record, secrets));
      })
      .filter(Boolean);
    output[name] = strToU8(lines.join("\n") + "\n");
    output[name.replace(/\.trace$/, ".network")] = strToU8("");
  }
  if (!Object.keys(output).length)
    throw new InputError("No supported trace operation records");
  const result = zipSync(output);
  if (result.byteLength > LIMIT)
    throw new InputError("Sanitized trace exceeds evidence limit");
  return result;
}
