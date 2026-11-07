import type { RunResult } from "../shared/types.js";
import type { Observations } from "../observations/schema.js";
import type { MapDocument, MapEdge } from "./schema.js";
import { MapError } from "./errors.js";
import { routeFor, safeToken } from "./normalize.js";
export function compatible(
  a: RunResult,
  b: RunResult,
  oa?: Observations,
  ob?: Observations,
) {
  const fingerprintA = oa && ob ? oa.flowFingerprint : a.metadata.checksum;
  const fingerprintB = oa && ob ? ob.flowFingerprint : b.metadata.checksum;
  if (
    !a.steps.length ||
    a.id === b.id ||
    fingerprintA !== fingerprintB ||
    JSON.stringify(a.steps.map((s) => [s.id, s.action])) !==
      JSON.stringify(b.steps.map((s) => [s.id, s.action]))
  )
    throw new MapError("INCOMPATIBLE_FLOWS");
}
export function compareRuns(
  a: RunResult,
  b: RunResult,
  edges: MapEdge[],
): NonNullable<MapDocument["comparison"]> {
  const changes = a.steps.flatMap((step, i) =>
    step.status === b.steps[i]!.status
      ? []
      : [
          {
            stepId: safeToken(step.id),
            baseline: step.status,
            candidate: b.steps[i]!.status,
          },
        ],
  );
  const observed = (id: string) =>
    new Set(
      edges
        .filter(
          (edge) =>
            edge.kind === "navigation" &&
            edge.provenance.some(
              (p) => p.runId === id && p.status.startsWith("observed_"),
            ),
        )
        .map((edge) => edge.id),
    );
  const baseline = observed(a.id),
    candidate = observed(b.id);
  const events = (run: RunResult) => {
    const result = new Map<
      string,
      { method: string; path: string; statuses: number[] }
    >();
    for (const event of run.http) {
      if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(event.method))
        continue;
      let route;
      try {
        route = routeFor(event.url, new URL(event.url).origin);
      } catch {
        continue;
      }
      if (!route) continue;
      const key = event.method + ":" + route.key;
      const item = result.get(key) ?? {
        method: event.method,
        path: route.path,
        statuses: [],
      };
      item.statuses.push(event.status);
      result.set(key, item);
    }
    return result;
  };
  const ah = events(a),
    bh = events(b);
  const httpChanges = [...new Set([...ah.keys(), ...bh.keys()])]
    .sort()
    .flatMap((key) => {
      const av = ah.get(key)?.statuses ?? [],
        bv = bh.get(key)?.statuses ?? [];
      return JSON.stringify(av) === JSON.stringify(bv)
        ? []
        : [
            {
              method: (ah.get(key) ?? bh.get(key))!.method,
              path: (ah.get(key) ?? bh.get(key))!.path,
              baseline: av,
              candidate: bv,
            },
          ];
    });
  return {
    baselineRunId: a.id,
    candidateRunId: b.id,
    firstDivergence: changes[0]?.stepId,
    changes,
    addedTransitions: [...candidate].filter((id) => !baseline.has(id)),
    removedTransitions: [...baseline].filter((id) => !candidate.has(id)),
    httpChanges,
  };
}
