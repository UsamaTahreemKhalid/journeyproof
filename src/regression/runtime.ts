import { runJourney } from "../engine/run.js";
import type { StepExecutor } from "../engine/steps.js";
import { planSchema } from "./model.js";
import { InputError } from "../shared/errors.js";
import { baseOrigin } from "../shared/safety.js";
export { pathMatches } from "../shared/safety.js";
export async function runRegression(
  input: unknown,
  executor: StepExecutor,
  options: {
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    outputDir?: string;
  } = {},
) {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success || !parsed.data.eligible)
    throw new InputError("Invalid or ineligible regression plan");
  const plan = parsed.data;
  const env = options.env ?? process.env;
  if (!env.JP_BASE_URL)
    throw new InputError(
      "JP_BASE_URL is required; use an authorized numeric loopback fixture",
    );
  const origin = baseOrigin(env.JP_BASE_URL);
  if (!["127.0.0.1", "[::1]"].includes(new URL(origin).hostname))
    throw new InputError("Generated regressions require numeric loopback");
  for (const step of plan.journey.steps)
    if (step.action === "fill") {
      const value = env[step.valueFromEnv!];
      // Very short/common secrets can corrupt structural evidence during substring redaction.
      if (
        !value ||
        value.length < 3 ||
        ["passed", "failed", "error", "skipped"].some((s) => s.includes(value))
      )
        throw new InputError(
          "Required regression input missing or unsafe for evidence redaction: " +
            step.valueFromEnv,
        );
    }
  return runJourney({
    journey: plan.journey,
    source: {
      file: plan.source.flowId + ".yaml",
      checksum: plan.source.checksum,
    },
    baseUrl: origin,
    outputDir: options.outputDir,
    // Finish execution before the generated test deadline, leaving room for evidence cleanup.
    runTimeoutMs: 45000,
    env,
    signal: options.signal,
    stepExecutor: executor,
  });
}

export type { StepExecutor } from "../engine/steps.js";
