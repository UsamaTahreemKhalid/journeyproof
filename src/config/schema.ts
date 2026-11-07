import { z } from "zod";
import { observationLimitsSchema } from "../observations/schema.js";
import { roleSchema, hintSchema } from "../map/normalize.js";
import { safePath } from "../shared/safety.js";
const short = z.string().min(1).max(500);
export const locatorSchema = z.union([
  z.strictObject({
    role: z.enum([
      "button",
      "link",
      "textbox",
      "heading",
      "status",
      "alert",
      "combobox",
      "checkbox",
      "radio",
      "dialog",
      "cell",
      "row",
    ]),
    name: short,
  }),
  z.strictObject({ testId: short }),
]);
const common = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  timeoutMs: z.number().int().min(100).max(30000).optional(),
};
const path = z
  .string()
  .max(500)
  .refine(
    (v) => safePath(v),
    "Use a same-origin path without query, fragment, encoding or traversal",
  );
const pattern = z
  .string()
  .max(500)
  .refine(
    (v) => safePath(v, true),
    "Use a safe pathname with optional * segment wildcard",
  );
export const stepSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...common, action: z.literal("goto"), path }),
  z.strictObject({
    ...common,
    action: z.literal("fill"),
    locator: locatorSchema,
    value: z.string().max(2000).optional(),
    valueFromEnv: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]{0,99}$/)
      .optional(),
    sensitive: z.boolean().optional(),
  }),
  z.strictObject({
    ...common,
    action: z.literal("click"),
    locator: locatorSchema,
  }),
  z.strictObject({
    ...common,
    action: z.literal("expectVisible"),
    locator: locatorSchema,
  }),
  z.strictObject({
    ...common,
    action: z.literal("expectText"),
    locator: locatorSchema,
    text: short,
    contains: z.boolean().optional(),
  }),
  z.strictObject({ ...common, action: z.literal("expectUrl"), path: pattern }),
  z.strictObject({
    ...common,
    action: z.literal("expectResponse"),
    locator: locatorSchema,
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: pattern,
    status: z.number().int().min(100).max(599),
  }),
]);
export const journeySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    name: short,
    role: roleSchema.optional(),
    routeHints: z.array(hintSchema).max(30).optional(),
    observations: observationLimitsSchema.optional(),
    baseUrl: z.string().max(1000).optional(),
    steps: z.array(stepSchema).min(1).max(100),
  })
  .superRefine((flow, ctx) => {
    const ids = new Set<string>();
    flow.steps.forEach((step, i) => {
      if (ids.has(step.id))
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "id"],
          message: "Duplicate step ID",
        });
      ids.add(step.id);
      if (
        step.action === "fill" &&
        ((step.value === undefined) === (step.valueFromEnv === undefined) ||
          (step.sensitive && !step.valueFromEnv))
      )
        ctx.addIssue({
          code: "custom",
          path: ["steps", i],
          message:
            "Fill needs exactly one of value/valueFromEnv; sensitive fields require valueFromEnv",
        });
    });
  });
export type Journey = z.infer<typeof journeySchema>;
export type Step = Journey["steps"][number];
export type LocatorSpec = z.infer<typeof locatorSchema>;
