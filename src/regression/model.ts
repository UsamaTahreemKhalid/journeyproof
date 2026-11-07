import { z } from "zod";
import { journeySchema } from "../config/schema.js";
import { runIdSchema } from "../map/schema.js";
export const sourceLinkSchema = z.strictObject({
  schemaVersion: z.literal(1),
  flowPath: z.string().min(1).max(240),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
});
export const planSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    generatorVersion: z.literal("1"),
    source: z.strictObject({
      flowId: z.string().regex(/^flow-[a-f0-9]{20}$/),
      checksum: z.string().regex(/^[a-f0-9]{64}$/),
      runId: runIdSchema.optional(),
      mode: z.enum(["verified-run", "definition-only"]),
    }),
    journey: journeySchema,
    evidence: z
      .array(
        z.strictObject({
          stepId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
          origin: z.enum([
            "explicit-yaml",
            "action-only",
            "structural-navigation",
          ]),
          observationSeq: z.number().int().nonnegative().optional(),
          httpEventIndex: z.number().int().min(0).max(199).optional(),
        }),
      )
      .min(1)
      .max(100),
    diagnostics: z
      .array(
        z.enum([
          "DEFINITION_ONLY",
          "NO_FINAL_OUTCOME",
          "UNVERIFIED_RUN",
          "MISSING_RESPONSE_EVIDENCE",
          "PRIVATE_DEFINITION",
          "UNSUPPORTED_INPUT",
        ]),
      )
      .max(5),
    eligible: z.boolean(),
  })
  .superRefine((plan, ctx) => {
    if (
      plan.evidence.some((e, i) => {
        const step = plan.journey.steps[i];
        const origin = step?.action.startsWith("expect")
          ? "explicit-yaml"
          : step?.action === "goto"
            ? "structural-navigation"
            : "action-only";
        return (
          e.origin !== origin ||
          (plan.eligible &&
            plan.source.mode === "verified-run" &&
            (e.observationSeq === undefined ||
              (step?.action === "expectResponse" &&
                e.httpEventIndex === undefined)))
        );
      })
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Step evidence must preserve assertion origin and verified observation references",
      });
    if (
      (plan.source.mode === "definition-only") !==
      plan.diagnostics.includes("DEFINITION_ONLY")
    )
      ctx.addIssue({
        code: "custom",
        message: "Definition-only warning must match source mode",
      });
    if (
      plan.evidence.length !== plan.journey.steps.length ||
      plan.evidence.some((e, i) => e.stepId !== plan.journey.steps[i]?.id)
    )
      ctx.addIssue({
        code: "custom",
        message: "Evidence must match stable ordered step IDs",
      });
    if (
      plan.eligible &&
      !["expectVisible", "expectText", "expectResponse"].includes(
        plan.journey.steps.at(-1)!.action,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Explicit final outcome required",
      });
    if (
      plan.journey.baseUrl ||
      plan.journey.steps.some(
        (s) =>
          s.action === "fill" && (s.value !== undefined || !s.valueFromEnv),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Plan must use environment inputs and no embedded origin",
      });
    if ((plan.source.mode === "verified-run") !== Boolean(plan.source.runId))
      ctx.addIssue({ code: "custom", message: "Run provenance required" });
    if (
      plan.eligible !== !plan.diagnostics.some((d) => d !== "DEFINITION_ONLY")
    )
      ctx.addIssue({
        code: "custom",
        message: "Eligibility and diagnostics disagree",
      });
  });
export type RegressionPlan = z.infer<typeof planSchema>;
