import { z } from "zod";
const artifact = z.enum(["failure.png", "trace.zip"]);
export const runSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^\d{13}-[a-f0-9]{8}$/),
  name: z.string().max(500),
  status: z.enum(["passed", "failed", "error"]),
  startedAt: z.iso.datetime(),
  durationMs: z.number().nonnegative(),
  metadata: z.strictObject({
    toolVersion: z.string(),
    nodeVersion: z.string(),
    browserVersion: z.string().optional(),
    hostname: z.string(),
    flowFile: z.string(),
    checksum: z.string(),
  }),
  reproduction: z.string(),
  steps: z
    .array(
      z.strictObject({
        id: z.string(),
        action: z.string(),
        status: z.enum(["passed", "failed", "skipped"]),
        durationMs: z.number().nonnegative(),
        expected: z.string(),
        observed: z.string(),
        reason: z.string().optional(),
        screenshot: artifact.optional(),
      }),
    )
    .max(100),
  http: z
    .array(
      z.strictObject({
        method: z.string(),
        url: z.string(),
        status: z.number(),
        timeMs: z.number(),
      }),
    )
    .max(200),
  errors: z.array(z.string()).max(100),
  warnings: z.array(z.string()).max(100),
  trace: artifact.optional(),
});
export type RunResult = z.infer<typeof runSchema>;
export type StepResult = RunResult["steps"][number];
export function summarize(run: RunResult) {
  return {
    passed: run.steps.filter((s) => s.status === "passed").length,
    failed: run.steps.filter((s) => s.status === "failed").length,
    skipped: run.steps.filter((s) => s.status === "skipped").length,
  };
}
