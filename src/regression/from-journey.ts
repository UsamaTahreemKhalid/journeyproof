import { createHash } from "node:crypto";
import { journeySchema, type Journey, type Step } from "../config/schema.js";
import type { MapSource } from "../map/build.js";
import { pathMatches } from "../shared/safety.js";
import { planSchema, type RegressionPlan } from "./model.js";
export const isAssertion = (step: Step) => step.action.startsWith("expect");
export function matchesSource(
  journey: Journey,
  checksum: string,
  source: MapSource,
) {
  return (
    source.run.metadata.checksum === checksum &&
    source.run.steps.length === journey.steps.length &&
    journey.steps.every(
      (s, i) =>
        s.id === source.run.steps[i]?.id &&
        s.action === source.run.steps[i]?.action,
    )
  );
}
export function responseEvidence(
  step: Extract<Step, { action: "expectResponse" }>,
  source: MapSource,
): number | undefined {
  const event = source.observations?.events.find(
    (e) => e.type === "step" && e.stepId === step.id && e.outcome === "passed",
  );
  if (!event || event.startedAtMs === undefined) return undefined;
  const candidates = source.run.http.flatMap((h, index) => {
    try {
      return h.timeMs >= event.startedAtMs! &&
        h.timeMs <= event.atMs &&
        h.method === step.method &&
        pathMatches(step.path, new URL(h.url).pathname)
        ? [{ index, status: h.status }]
        : [];
    } catch {
      return [];
    }
  });
  return candidates.length === 1 && candidates[0]!.status === step.status
    ? candidates[0]!.index
    : undefined;
}
export function responseProven(
  step: Extract<Step, { action: "expectResponse" }>,
  source: MapSource,
) {
  return responseEvidence(step, source) !== undefined;
}
export function toPlan(
  input: Journey,
  checksum: string,
  source?: MapSource,
): RegressionPlan {
  const journey = journeySchema.parse(input);
  const flowId =
    "flow-" + createHash("sha256").update(checksum).digest("hex").slice(0, 20);
  const diagnostics: RegressionPlan["diagnostics"] = [];
  if (!source) diagnostics.push("DEFINITION_ONLY");
  const last = journey.steps.at(-1)!;
  if (!["expectVisible", "expectText", "expectResponse"].includes(last.action))
    diagnostics.push("NO_FINAL_OUTCOME");
  if (
    source &&
    (!matchesSource(journey, checksum, source) ||
      source.run.status !== "passed" ||
      !source.observations ||
      source.observations.runId !== source.run.id ||
      source.observations.role !== journey.role ||
      source.observations.declarations.length !== journey.steps.length ||
      source.observations.declarations.some(
        (d, i) => d.stepId !== journey.steps[i]?.id,
      ) ||
      source.observations.truncated ||
      journey.steps.some(
        (s) =>
          source.run.steps.find((r) => r.id === s.id)?.status !== "passed" ||
          !source.observations!.events.some(
            (e) =>
              e.type === "step" && e.stepId === s.id && e.outcome === "passed",
          ),
      ))
  )
    diagnostics.push("UNVERIFIED_RUN");
  if (
    source &&
    journey.steps.some(
      (s) => s.action === "expectResponse" && !responseProven(s, source),
    )
  )
    diagnostics.push("MISSING_RESPONSE_EVIDENCE");
  if (
    journey.steps.some(
      (s) =>
        s.action === "fill" &&
        s.value !== undefined &&
        (s.value.length < 3 ||
          ["passed", "failed", "error", "skipped"].some((status) =>
            status.includes(s.value!),
          )),
    )
  )
    diagnostics.push("UNSUPPORTED_INPUT");
  const literals = journey.steps.flatMap((s) =>
    s.action === "fill" && s.value ? [s.value] : [],
  );
  // Private inputs embedded in selectors/assertions cannot be safely retained or guessed.
  const structural = JSON.stringify(
    journey.steps.map((s) =>
      s.action === "fill" ? { ...s, value: undefined } : s,
    ),
  );
  if (
    literals.some((v) => structural.includes(JSON.stringify(v).slice(1, -1))) ||
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:bearer\s|password=|token=|cookie=)/i.test(
      structural,
    )
  )
    diagnostics.push("PRIVATE_DEFINITION");
  const used = new Set(
    journey.steps.flatMap((s) =>
      s.action === "fill" && s.valueFromEnv ? [s.valueFromEnv] : [],
    ),
  );
  const steps = journey.steps.map((s, index) => {
    if (s.action !== "fill") return s;
    const base = `JP_INPUT_${checksum.slice(0, 8).toUpperCase()}_${index}_${s.id.toUpperCase().replace(/-/g, "_")}`;
    let binding = base,
      suffix = 0;
    while (used.has(binding)) binding = base + "_" + ++suffix;
    used.add(binding);
    return {
      id: s.id,
      action: s.action,
      locator: s.locator,
      timeoutMs: s.timeoutMs,
      valueFromEnv: s.valueFromEnv ?? binding,
      sensitive: true,
    };
  });
  // Avoid leaking private titles: stable source identity is enough for the header.
  return planSchema.parse({
    schemaVersion: 1,
    generatorVersion: "1",
    source: {
      flowId,
      checksum,
      runId: source?.run.id,
      mode: source ? "verified-run" : "definition-only",
    },
    journey: {
      schemaVersion: 1,
      name: flowId,
      role: journey.role,
      routeHints: journey.routeHints,
      steps,
    },
    evidence: journey.steps.map((s) => ({
      stepId: s.id,
      origin: isAssertion(s)
        ? "explicit-yaml"
        : s.action === "goto"
          ? "structural-navigation"
          : "action-only",
      observationSeq: source?.observations?.events.find(
        (e) => e.type === "step" && e.stepId === s.id,
      )?.seq,
      httpEventIndex:
        source && s.action === "expectResponse"
          ? responseEvidence(s, source)
          : undefined,
    })),
    diagnostics,
    eligible: !diagnostics.some((d) => d !== "DEFINITION_ONLY"),
  });
}
