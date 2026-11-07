import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { parseDocument, visit, isAlias } from "yaml";
import { journeySchema, type Journey } from "./schema.js";
import { InputError } from "../shared/errors.js";
export function parseJourney(source: string): Journey {
  if (Buffer.byteLength(source) > 128 * 1024)
    throw new InputError("Journey file exceeds 128 KiB");
  const doc = parseDocument(source, { uniqueKeys: true, customTags: [] });
  if (doc.errors.length || doc.warnings.length)
    throw new InputError("Invalid YAML: check syntax, duplicate keys and tags");
  visit(doc, (_, node) => {
    if (
      isAlias(node) ||
      (node &&
        typeof node === "object" &&
        (("anchor" in node && node.anchor) || ("tag" in node && node.tag)))
    )
      throw new InputError("YAML anchors, aliases and tags are not supported");
  });
  const result = journeySchema.safeParse(doc.toJS({ maxAliasCount: 0 }));
  if (!result.success) {
    const error = new InputError(
      "Invalid journey: check schemaVersion 1, supported actions, unique step IDs, explicit outcomes and locator/value fields; see docs/JOURNEY_SCHEMA.md",
    );
    const fields = new Set([
      "schemaVersion",
      "name",
      "baseUrl",
      "steps",
      "id",
      "action",
      "timeoutMs",
      "path",
      "locator",
      "role",
      "testId",
      "value",
      "valueFromEnv",
      "sensitive",
      "text",
      "contains",
      "method",
      "status",
    ]);
    error.diagnostics = result.error.issues.slice(0, 20).map((issue) => ({
      path: issue.path
        .map((part) =>
          typeof part === "number"
            ? String(part)
            : fields.has(String(part))
              ? String(part)
              : "field",
        )
        .join(".")
        .slice(0, 200),
      code: issue.code,
    }));
    throw error;
  }
  return result.data;
}
export async function loadJourney(file: string) {
  try {
    if ((await stat(file)).size > 128 * 1024)
      throw new InputError("Journey file exceeds 128 KiB");
    const source = await readFile(file, "utf8");
    return {
      journey: parseJourney(source),
      source: {
        file: basename(file),
        checksum: createHash("sha256").update(source).digest("hex"),
      },
    };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError(
      "Cannot read journey file; check --flow path and permissions",
    );
  }
}
export function resolveValues(journey: Journey, env: NodeJS.ProcessEnv) {
  const values: Record<string, string> = Object.create(null);
  const secrets: string[] = [];
  for (const step of journey.steps)
    if (step.action === "fill") {
      const value = step.valueFromEnv ? env[step.valueFromEnv] : step.value;
      if (value === undefined)
        throw new InputError(
          `Missing environment variable: ${step.valueFromEnv}`,
        );
      if (value.length > 2000 || (value.length === 0 && step.valueFromEnv))
        throw new InputError(
          `Environment value must contain 1–2000 characters: ${step.valueFromEnv}`,
        );
      values[step.id] = value;
      if (step.valueFromEnv) secrets.push(value);
    }
  return { values, secrets };
}
