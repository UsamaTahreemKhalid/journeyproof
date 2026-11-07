import type { RunResult } from "../shared/types.js";
import { summarize } from "../shared/types.js";
import { VERSION } from "../shared/version.js";
import type { Observations } from "../observations/schema.js";
import {
  mapSchema,
  type MapDocument,
  type MapNode,
  type MapEdge,
  type State,
  type Provenance,
} from "./schema.js";
import {
  digest,
  safeToken,
  safeReason,
  routeFor,
  type Route,
} from "./normalize.js";
import { compatible, compareRuns } from "./compare.js";
import { MapError } from "./errors.js";
export interface MapSource {
  run: RunResult;
  observations?: Observations;
  evidence: MapDocument["evidence"];
}
const priority: State[] = [
  "observed_failed",
  "observed_passed",
  "observed_unasserted",
  "linked_unvisited",
  "declared_unreached",
  "unknown",
];
export function combined(states: State[]): State {
  return priority.find((state) => states.includes(state)) ?? "unknown";
}
export function buildMap(sources: MapSource[], role?: string): MapDocument {
  if (!sources.length || sources.length > 2)
    throw new MapError("INVALID_ARTIFACT");
  if (sources.length === 2)
    compatible(
      sources[0]!.run,
      sources[1]!.run,
      sources[0]!.observations,
      sources[1]!.observations,
    );
  const selected = sources.filter(
    (source) => !role || source.observations?.role === role,
  );
  if (!selected.length) throw new MapError("ROLE_NOT_FOUND");
  const nodes = new Map<string, MapNode>(),
    edges = new Map<string, MapEdge>();
  const warnings = new Set<string>();
  const addNode = (
    key: string,
    fields: Omit<MapNode, "id" | "provenance" | "status" | "evidence">,
    provenance: Provenance,
    evidence: MapDocument["evidence"],
  ) => {
    const id = "n-" + digest(key);
    const existing = nodes.get(id);
    const node = existing ?? {
      ...fields,
      id,
      provenance: [],
      evidence: [],
      status: "unknown" as State,
    };
    node.provenance.push(provenance);
    node.http = [...(existing?.http ?? []), ...(fields.http ?? [])].slice(
      0,
      20,
    );
    if (provenance.status === "observed_failed") node.detail = fields.detail;
    node.stepIds = [
      ...new Set([
        ...node.stepIds,
        ...(provenance.stepId ? [provenance.stepId] : []),
      ]),
    ];
    node.evidence = [
      ...new Map(
        [...node.evidence, ...evidence].map((e) => [e.runId + e.kind, e]),
      ).values(),
    ];
    node.status = combined(node.provenance.map((p) => p.status));
    node.sequence = Math.min(node.sequence, fields.sequence);
    nodes.set(id, node);
    return id;
  };
  const addEdge = (
    from: string,
    to: string,
    kind: MapEdge["kind"],
    provenance: Provenance,
  ) => {
    const id = "e-" + digest(from + ":" + to + ":" + kind);
    const edge = edges.get(id) ?? {
      id,
      from,
      to,
      kind,
      provenance: [],
      status: "unknown" as State,
    };
    edge.provenance.push(provenance);
    edge.status = combined(edge.provenance.map((p) => p.status));
    edges.set(id, edge);
  };
  for (const { run, observations: obs, evidence } of [...selected].sort(
    (a, b) => a.run.id.localeCompare(b.run.id),
  )) {
    if (obs?.runId !== undefined && obs.runId !== run.id)
      throw new MapError("INVALID_ARTIFACT");
    if (!obs)
      warnings.add(
        "Legacy run: no browser observations; routes and transitions remain unknown.",
      );
    if (obs?.truncated)
      warnings.add(
        "Observation limits or interrupted scans omitted some browser events.",
      );
    const flow = obs?.flowFingerprint ?? digest(run.metadata.checksum);
    const events = [...(obs?.events ?? [])].sort((a, b) => a.seq - b.seq);
    const visits = new Set(
      events
        .filter((e) => e.type === "navigation" || e.type === "step")
        .flatMap((e) => (e.route ? [e.route.key] : [])),
    );
    const page = (route: Route, provenance: Provenance) => {
      if (route.basis === "hint")
        warnings.add(
          "Routes merge only where an explicit operator route hint matches.",
        );
      if (route.basis === "redacted")
        warnings.add(
          "Private or dynamic path segments are redacted; exact route keys remain distinct without a hint.",
        );
      return addNode(
        flow + ":page:" + route.key,
        {
          kind: "page",
          title: route.path === "/" ? "Home" : route.path,
          route: route.path,
          stepIds: [],
          sequence: provenance.sequence,
          detail:
            "Use provenance to distinguish visits, declarations and visible anchors. No business correctness is implied.",
        },
        provenance,
        evidence,
      );
    };
    let lastNavigation: string | undefined;
    for (const event of events) {
      const p: Provenance = {
        runId: run.id,
        stepId: event.stepId,
        sequence: event.seq,
        atMs: event.atMs,
        status: "observed_unasserted",
        basis: event.type === "navigation" ? "browser-navigation" : "step-url",
      };
      if (event.type === "navigation" && event.route) {
        const destination = page(event.route, p);
        if (lastNavigation && lastNavigation !== destination)
          addEdge(lastNavigation, destination, "navigation", p);
        lastNavigation = destination;
      }
      if (event.type === "popup") {
        warnings.add(
          "An extra page was observed and blocked by the one-page policy; its destination is not verified.",
        );
        if (event.route) {
          const popup = page(event.route, {
            ...p,
            status: "unknown",
            basis: "blocked-popup",
          });
          if (lastNavigation && event.openerPageId === "page-1")
            addEdge(lastNavigation, popup, "blocked-popup", {
              ...p,
              status: "unknown",
              basis: "blocked-popup",
            });
        }
      }
      if (event.type === "link" && event.route && event.target) {
        const from = page(event.route, { ...p, basis: "step-url" });
        const status: State = visits.has(event.target.key)
          ? "observed_unasserted"
          : "linked_unvisited";
        const to = page(event.target, {
          ...p,
          status,
          basis: "visible-anchor",
        });
        addEdge(from, to, "visible-link", {
          ...p,
          status: "linked_unvisited",
          basis: "visible-anchor",
        });
      }
    }
    let previous: string | undefined;
    run.steps.forEach((originalStep, index) => {
      const step = {
        ...originalStep,
        id: obs?.declarations[index]?.stepId ?? safeToken(originalStep.id),
      };
      const event = events.find(
        (e) => e.type === "step" && e.stepId === safeToken(step.id),
      );
      const state: State =
        step.status === "skipped"
          ? "declared_unreached"
          : step.status === "failed"
            ? "observed_failed"
            : step.action.startsWith("expect")
              ? "observed_passed"
              : "observed_unasserted";
      const detail =
        step.status === "failed"
          ? safeReason(step.reason)
          : step.status === "skipped"
            ? "Declared step was not reached; no execution is claimed."
            : step.action.startsWith("expect")
              ? "The configured " +
                safeToken(step.action) +
                " assertion passed in this execution."
              : "The " +
                safeToken(step.action) +
                " action completed; business correctness was not independently asserted.";
      const p: Provenance = {
        detail,
        runId: run.id,
        stepId: safeToken(step.id),
        sequence: event?.seq ?? index,
        atMs: event?.atMs,
        status: state,
        basis: obs ? "step-result" : "legacy-result",
      };
      const http =
        event?.startedAtMs === undefined
          ? []
          : run.http
              .filter(
                (item) =>
                  item.timeMs >= event.startedAtMs! &&
                  item.timeMs <= event.atMs,
              )
              .sort((a, b) => Number(b.status >= 400) - Number(a.status >= 400))
              .slice(0, 10)
              .flatMap((item) => {
                try {
                  const route = routeFor(item.url, new URL(item.url).origin);
                  return route &&
                    /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(
                      item.method,
                    )
                    ? [
                        {
                          runId: run.id,
                          method: item.method,
                          path: route.path,
                          status: item.status,
                        },
                      ]
                    : [];
                } catch {
                  return [];
                }
              });
      const node = addNode(
        flow + ":action:" + safeToken(step.id),
        {
          kind: "action",
          title: safeToken(step.id).replace(/[-_]/g, " "),
          stepIds: [safeToken(step.id)],
          sequence: index,
          route: (event?.before ?? event?.route)?.path,
          detail,
          http,
        },
        p,
        evidence,
      );
      if (previous)
        addEdge(
          previous,
          node,
          step.status === "skipped" ? "declared" : "sequence",
          {
            ...p,
            status:
              step.status === "skipped"
                ? "declared_unreached"
                : "observed_unasserted",
          },
        );
      previous = node;
      if (event?.before)
        addEdge(
          page(event.before, {
            ...p,
            status: "observed_unasserted",
            basis: "step-url",
          }),
          node,
          "action",
          p,
        );
      if (event?.route)
        addEdge(
          node,
          page(event.route, {
            ...p,
            status: "observed_unasserted",
            basis: "step-url",
          }),
          event.before?.key !== event.route.key ? "navigation" : "action",
          { ...p, status: "observed_unasserted", basis: "step-url" },
        );
      const intended = obs?.declarations.find(
        (d) => d.stepId === safeToken(step.id),
      )?.route;
      if (step.status === "skipped" && intended && !visits.has(intended.key))
        addEdge(
          node,
          page(intended, { ...p, basis: "flow-declaration" }),
          "declared",
          p,
        );
    });
  }
  const allNodes = [...nodes.values()].sort(
    (a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id),
  );
  const allEdges = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (allNodes.length > 500 || allEdges.length > 1500)
    throw new MapError("LIMIT_EXCEEDED");
  const observed = (status: State) => status.startsWith("observed_");
  const safeRun = (source: MapSource) => ({
    ...source.run,
    steps: source.run.steps.map((step, i) => ({
      ...step,
      id: source.observations?.declarations[i]?.stepId ?? safeToken(step.id),
    })),
  });
  const comparison =
    selected.length === 2
      ? compareRuns(safeRun(selected[0]!), safeRun(selected[1]!), allEdges)
      : undefined;
  if (comparison)
    warnings.add(
      "A transition absent from an incomplete run is not a deleted application screen.",
    );
  const data = {
    schemaVersion: 1 as const,
    generatorVersion: VERSION,
    sourceRunIds: selected.map((s) => s.run.id),
    flows: selected.map((s) => ({
      id: s.observations?.flowFingerprint ?? digest(s.run.metadata.checksum),
      name: s.observations?.flowName ?? "legacy-workflow",
      runId: s.run.id,
      role: s.observations?.role,
      status: s.run.status,
      startedAt: s.run.startedAt,
      counts: summarize(s.run),
    })),
    ...(role ? { roleFilter: role } : {}),
    nodes: allNodes,
    edges: allEdges,
    summary: {
      observedNodes: allNodes.filter((n) => observed(n.status)).length,
      observedEdges: allEdges.filter((e) => observed(e.status)).length,
      observedPages: allNodes.filter(
        (n) => n.kind === "page" && observed(n.status),
      ).length,
      passedSteps: selected.reduce((n, s) => n + summarize(s.run).passed, 0),
      failedSteps: selected.reduce((n, s) => n + summarize(s.run).failed, 0),
      notReachedSteps: selected.reduce(
        (n, s) => n + summarize(s.run).skipped,
        0,
      ),
      linkedUnvisited: allNodes.filter(
        (n) => n.kind === "page" && n.status === "linked_unvisited",
      ).length,
      configuredSteps: selected.reduce((n, s) => n + s.run.steps.length, 0),
    },
    ...(comparison ? { comparison } : {}),
    warnings: [...warnings],
    limitations: [
      "Only explicitly executed journeys and passive visible anchors are represented; this is not an application-wide coverage measurement.",
      "Role labels are descriptive metadata and do not prove identity, permissions or RBAC enforcement.",
      "Page visits and URL changes are unasserted observations. Delayed SPA changes beyond step boundaries may be missed.",
      "No page text, link labels, form values, cookies, headers or query strings are collected for the map.",
    ],
    evidence: selected.flatMap((s) => s.evidence),
  };
  return mapSchema.parse({
    ...data,
    mapId: "map-" + digest(JSON.stringify(data)),
    createdAt: new Date().toISOString(),
  });
}
