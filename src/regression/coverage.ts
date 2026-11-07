import type { Journey } from "../config/schema.js";
import type { MapSource } from "../map/build.js";
import { InputError } from "../shared/errors.js";
import { isAssertion, matchesSource, responseProven } from "./from-journey.js";
export function workflowCoverage(
  journey: Journey,
  checksum: string,
  sources: MapSource[],
) {
  if (
    !sources.length ||
    sources.length > 20 ||
    new Set(sources.map((s) => s.run.id)).size !== sources.length
  )
    throw new InputError("Coverage needs 1–20 distinct runs");
  if (sources.some((s) => !matchesSource(journey, checksum, s)))
    throw new InputError(
      "Coverage sources must match the exact flow checksum and step declarations",
    );
  const runs = sources.map((source) => {
    const steps = journey.steps.map((step) => {
      const result = source.run.steps.find((s) => s.id === step.id)!;
      const event = source.observations?.events.find(
        (e) =>
          e.type === "step" &&
          e.stepId === step.id &&
          e.outcome === result.status &&
          e.outcome !== "skipped",
      );
      const reached = Boolean(event);
      const asserted = reached && isAssertion(step);
      const supported =
        reached &&
        result.status === "passed" &&
        (step.action !== "expectResponse" || responseProven(step, source));
      return {
        id: step.id,
        action: step.action,
        state: reached
          ? result.status
          : result.status === "skipped"
            ? "not-reached"
            : "unknown",
        reached,
        asserted,
        passed: asserted && result.status === "passed",
        failed: reached && result.status === "failed",
        supported,
      };
    });
    const visited = new Set(
      source.observations?.events.flatMap((e) =>
        e.type === "navigation" && e.route ? [e.route.key] : [],
      ) ?? [],
    );
    const links = new Set(
      source.observations?.events.flatMap((e) =>
        e.type === "link" && e.target && !visited.has(e.target.key)
          ? [e.target.key]
          : [],
      ) ?? [],
    );
    const count = (
      key: "reached" | "asserted" | "passed" | "failed" | "supported",
    ) => steps.filter((s) => s[key]).length;
    return {
      runId: source.run.id,
      declared: steps.length,
      reached: count("reached"),
      asserted: count("asserted"),
      passed: count("passed"),
      failed: count("failed"),
      notReached: steps.filter((s) => s.state === "not-reached").length,
      unknown: steps.filter((s) => s.state === "unknown").length,
      supported: count("supported"),
      linkedUnvisited: source.observations ? links.size : null,
      incomplete: !source.observations || source.observations.truncated,
      steps,
    };
  });
  const reached = journey.steps.filter((s) =>
    runs.some((r) => r.steps.some((v) => v.id === s.id && v.reached)),
  ).length;
  const asserted = journey.steps.filter((s) =>
    runs.some((r) => r.steps.some((v) => v.id === s.id && v.asserted)),
  ).length;
  return {
    schemaVersion: 1,
    checksum,
    role: journey.role,
    scope:
      "Selected declared journey only; not code, route, RBAC or app coverage",
    declared: journey.steps.length,
    reached: { numerator: reached, denominator: journey.steps.length },
    asserted: { numerator: asserted, denominator: journey.steps.length },
    runs,
  };
}
export function coverageTable(report: ReturnType<typeof workflowCoverage>) {
  return [
    report.scope,
    "Run ID | Declared | Reached | Asserted | Passed assertions | Failed checks | Not reached | Unknown | Supported | Linked unvisited",
    ...report.runs.map((r) =>
      [
        r.runId,
        r.declared,
        r.reached,
        r.asserted,
        r.passed,
        r.failed,
        r.notReached,
        r.unknown,
        r.supported,
        r.linkedUnvisited ?? "unknown",
      ].join(" | "),
    ),
    `Union reached ${report.reached.numerator}/${report.declared}; executed assertions ${report.asserted.numerator}/${report.declared}. Successful actions do not count as passed assertions.`,
  ].join("\n");
}
