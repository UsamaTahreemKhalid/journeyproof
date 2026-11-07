import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { z } from "zod";
const path = z.string().min(1).max(240);
export const inputs = {
  doctor: z.strictObject({
    flowPath: path.optional(),
    checkBrowser: z.boolean().default(true),
  }),
  list: z.strictObject({
    directory: path.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  validate: z.strictObject({ flowPath: path }),
  run: z.strictObject({
    flowPath: path,
    baseUrl: z.string().min(1).max(500).optional(),
    timeoutMs: z.number().int().min(100).max(30000).default(5000),
    headed: z.boolean().default(false),
    allowRemote: z.boolean().default(false),
  }),
  report: z.strictObject({
    runId: z.string().regex(/^\d{13}-[a-f0-9]{8}$/),
    maxEvents: z.number().int().min(0).max(50).default(20),
  }),
};
const text = z.string().max(500);
const action = z.enum([
  "goto",
  "fill",
  "click",
  "expectVisible",
  "expectText",
  "expectUrl",
  "expectResponse",
]);
export const summarySchema = z.strictObject({
  runId: inputs.report.shape.runId,
  status: z.enum(["passed", "failed", "error"]),
  counts: z.strictObject({
    passed: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
  }),
  durationMs: z.number().nonnegative(),
  steps: z
    .array(
      z.strictObject({
        id: text,
        action: text,
        status: z.enum(["passed", "failed", "skipped"]),
      }),
    )
    .max(100),
  failure: z.strictObject({ stepId: text, reason: text }).optional(),
  http: z
    .array(
      z.strictObject({ method: text, path: text, status: z.number().int() }),
    )
    .max(50),
  evidence: z
    .array(
      z.strictObject({
        kind: z.enum(["json", "html", "screenshot", "trace"]),
        path: text,
        available: z.boolean(),
      }),
    )
    .max(4),
  truncated: z.boolean(),
  untrustedData: z.literal(true),
});
export const outputSchema = z.strictObject({
  status: z.enum(["ok", "passed", "failed", "error"]),
  data: z
    .union([
      summarySchema,
      z.strictObject({
        ok: z.boolean(),
        checks: z
          .array(z.strictObject({ name: text, ok: z.boolean(), detail: text }))
          .max(4),
      }),
      z.strictObject({
        flows: z
          .array(z.strictObject({ path: text, name: text, valid: z.boolean() }))
          .max(50),
        truncated: z.boolean(),
        untrustedData: z.literal(true),
      }),
      z.strictObject({
        valid: z.literal(true),
        stepCount: z.number().int(),
        actions: z.array(action).max(7),
      }),
    ])
    .optional(),
  code: text.optional(),
  message: text.optional(),
  suggestion: text.optional(),
  diagnostics: z
    .array(z.strictObject({ path: z.string().max(200), code: text }))
    .max(20)
    .optional(),
});

// SDK input errors otherwise echo attacker-controlled unknown keys. Preserve the
// advertised strict Zod schema while replacing validation diagnostics at the boundary.
export function safeInput<S extends z.ZodType>(
  schema: S,
): StandardSchemaWithJSON<z.input<S>, z.output<S>> {
  return {
    "~standard": {
      version: 1,
      vendor: "journeyproof-zod",
      jsonSchema: {
        input: () => z.toJSONSchema(schema, { io: "input" }),
        output: () => z.toJSONSchema(schema, { io: "output" }),
      },
      validate: (value) => {
        const result = schema.safeParse(value);
        return result.success
          ? { value: result.data }
          : {
              issues: [
                {
                  message:
                    "Invalid tool arguments; use the advertised schema and bounds.",
                },
              ],
            };
      },
    },
  };
}
