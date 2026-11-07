import { it, expect } from "vitest";
import { buildMap, combined } from "../../src/map/build.js";
import { mapSchema } from "../../src/map/schema.js";
import { routeFor, safeReason } from "../../src/map/normalize.js";
const origin = "http://127.0.0.1:4173";
import { modelSource } from "./fixtures.js";
it("builds stable graphs, preserves same-page actions and distinguishes observation from assertion", () => {
  const source = modelSource();
  const a = buildMap([source]),
    b = buildMap([source]);
  expect(a.mapId).toBe(b.mapId);
  expect(a.nodes).toEqual(b.nodes);
  expect(a.edges).toEqual(b.edges);
  expect(a.nodes.filter((n) => n.kind === "action")).toHaveLength(4);
  expect(
    a.nodes.find((n) => n.kind === "action" && n.stepIds.includes("fill"))!
      .status,
  ).toBe("observed_unasserted");
  expect(
    a.nodes.find((n) => n.kind === "action" && n.stepIds.includes("verify"))!
      .status,
  ).toBe("observed_passed");
  expect(
    a.nodes.find((n) => n.route === "/admissions" && n.kind === "page")!.status,
  ).toBe("observed_unasserted");
  expect(a.nodes.find((n) => n.route === "/guide")!.status).toBe(
    "linked_unvisited",
  );
  expect(a.summary).toMatchObject({
    passedSteps: 4,
    failedSteps: 0,
    linkedUnvisited: 1,
    configuredSteps: 4,
  });
  expect(JSON.stringify(a)).not.toContain("token=hidden");
  expect(JSON.stringify(a)).not.toContain("coveragePercent");
});
it("compares genuine outcome evidence, not inferred screen deletion or root cause", () => {
  const good = modelSource(),
    bad = modelSource(true);
  good.observations!.events.push({
    seq: 100,
    atMs: 100,
    type: "navigation",
    pageId: "page-1",
    route: routeFor("/completed", origin)!,
  });
  const map = buildMap([good, bad]);
  expect(map.comparison!.removedTransitions.length).toBeGreaterThan(0);
  expect(map.comparison!.firstDivergence).toBe("approve");
  expect(map.comparison!.changes).toEqual([
    { stepId: "approve", baseline: "passed", candidate: "failed" },
    { stepId: "verify", baseline: "passed", candidate: "skipped" },
  ]);
  expect(map.comparison!.httpChanges).toContainEqual({
    method: "POST",
    path: "/api/approve",
    baseline: [200],
    candidate: [500],
  });
  expect(
    map.nodes.find((n) => n.kind === "action" && n.stepIds.includes("approve"))!
      .detail,
  ).toContain("observed HTTP 500");
  expect(map.warnings).toContain(
    "A transition absent from an incomplete run is not a deleted application screen.",
  );
  const onlyBad = buildMap([bad]);
  expect(onlyBad.summary.notReachedSteps).toBe(1);
  expect(
    onlyBad.nodes.find(
      (n) => n.kind === "action" && n.stepIds.includes("verify"),
    )!.status,
  ).toBe("declared_unreached");
});
it("marks declared destinations, bounded captures and blocked popups honestly", () => {
  const source = modelSource(true);
  const obs = source.observations!;
  obs.declarations[3]!.route = routeFor("/future", origin)!;
  obs.events.push({
    seq: 80,
    atMs: 80,
    type: "popup",
    pageId: "page-2",
    openerPageId: "page-1",
    route: routeFor("/popup", origin)!,
    outcome: "blocked",
  });
  obs.events.push({
    seq: 82,
    atMs: 82,
    type: "navigation",
    pageId: "page-1",
    route: routeFor("/other", origin)!,
  });
  obs.events.push({
    seq: 81,
    atMs: 81,
    type: "navigation",
    pageId: "page-1",
    route: routeFor("/first", origin)!,
  });
  obs.truncated = true;
  const map = buildMap([source]);
  expect(map.nodes.find((n) => n.route === "/future")!.status).toBe(
    "declared_unreached",
  );
  expect(map.nodes.find((n) => n.route === "/popup")!.status).toBe("unknown");
  expect(map.warnings.some((w) => w.includes("blocked"))).toBe(true);
  expect(map.warnings.some((w) => w.includes("limits"))).toBe(true);
  expect(map.edges.some((e) => e.kind === "navigation")).toBe(true);
  expect(map.edges.some((e) => e.kind === "blocked-popup")).toBe(true);
});
it("supports old run artifacts without inventing routes, and rejects incompatible sources", () => {
  const source = modelSource();
  delete source.observations;
  const legacy = buildMap([source]);
  expect(legacy.nodes.every((n) => n.kind === "action")).toBe(true);
  expect(legacy.warnings[0]).toContain("Legacy");
  const candidate = modelSource(true);
  candidate.observations!.flowFingerprint = "b".repeat(20);
  expect(() => buildMap([modelSource(), candidate])).toThrow("compatible");
  expect(() => buildMap([modelSource(), modelSource()])).toThrow("compatible");
  expect(() => buildMap([])).toThrow();
  expect(() => buildMap([modelSource()], "other-role")).toThrow("role");
  expect(buildMap([modelSource()], "admissions-officer").roleFilter).toBe(
    "admissions-officer",
  );
  source.run.steps = [];
  expect(buildMap([source]).summary.configuredSteps).toBe(0);
  expect(combined([])).toBe("unknown");
  const mismatch = modelSource();
  mismatch.observations!.runId = candidate.run.id;
  expect(() => buildMap([mismatch])).toThrow();
});
it("normalizes only explicit route hints, strips URL secrets and preserves distinct exact keys", () => {
  const a = routeFor("/students/42?secret=abc#token", origin)!,
    b = routeFor("/students/43", origin)!;
  expect(a.key).not.toBe(b.key);
  expect(a.path).not.toContain("42");
  expect(routeFor("/students/42", origin, ["/students/:id"])!.key).toBe(
    routeFor("/students/43", origin, ["/students/:id"])!.key,
  );
  for (const value of [
    "https://external.test/",
    "javascript:alert(1)",
    "data:text/html,secret",
    "file:///etc/passwd",
    "http://user:secret@127.0.0.1:4173/",
    "http://[invalid",
  ])
    expect(routeFor(value, origin)).toBeUndefined();
  expect(
    routeFor("/secret", origin, ["/secret"], ["secret"])!.path,
  ).not.toContain("secret");
  expect(routeFor("/" + "a/".repeat(400), origin)!.path).toContain(
    "redacted-route",
  );
  expect(routeFor("/" + "a".repeat(1001), origin)).toBeUndefined();
  const source = modelSource();
  source.observations!.events[0]!.route = routeFor("/students/42", origin, [
    "/students/:id",
  ]);
  expect(buildMap([source]).warnings.some((w) => w.includes("hint"))).toBe(
    true,
  );
  source.observations!.events[0]!.route = a;
  expect(buildMap([source]).warnings.some((w) => w.includes("redacted"))).toBe(
    true,
  );
  expect(safeReason("Navigation returned HTTP 503")).toContain("503");
  expect(safeReason("Run interrupted")).toContain("interrupted");
});
it("validates graph references, bounded structures and corrupt versions", () => {
  const map = buildMap([modelSource()]);
  const oversized = modelSource();
  oversized.observations!.events = Array.from({ length: 600 }, (_, i) => ({
    seq: i,
    atMs: i,
    type: "navigation" as const,
    pageId: "page-1",
    route: routeFor("/page/" + i, origin)!,
  }));
  expect(() => buildMap([oversized])).toThrow("limit");
  expect(mapSchema.safeParse({ ...map, schemaVersion: 9 }).success).toBe(false);
  expect(
    mapSchema.safeParse({ ...map, nodes: [...map.nodes, map.nodes[0]] })
      .success,
  ).toBe(false);
  expect(
    mapSchema.safeParse({
      ...map,
      edges: [{ ...map.edges[0], from: "n-" + "f".repeat(20) }],
    }).success,
  ).toBe(false);
  expect(
    mapSchema.safeParse({ ...map, sourceRunIds: ["1793730000099-abcd1234"] })
      .success,
  ).toBe(false);
});

it("escapes malicious embedded JSON and preserves a restrictive executable hash policy", async () => {
  const { renderExplorer } = await import("../../src/viewer/render.js");
  const map = buildMap([modelSource()]);
  map.nodes[0]!.title = '</script><img src=x onerror="globalThis.pwned=true">';
  map.flows[0]!.name = "<script>&\u2028\u2029";
  const html = renderExplorer(map);
  expect(html).not.toContain(map.nodes[0]!.title);
  expect(html).toContain("\\u003c/script\\u003e");
  expect(html).toContain("connect-src 'none'");
  expect(html.match(/<script/g)).toHaveLength(2);
});

it("preserves numeric HTTP diagnostics from generated regressions without exposing untrusted suffixes", () => {
  expect(safeReason("Expected HTTP 200; observed HTTP 500")).toBe(
    "Expected HTTP 200; observed HTTP 500.",
  );
  expect(safeReason("Expected HTTP 200; observed HTTP 500.")).toBe(
    "Expected HTTP 200; observed HTTP 500.",
  );
  expect(
    safeReason(
      "Expected HTTP 200; observed HTTP 500 for /private?token=secret",
    ),
  ).not.toContain("secret");
  expect(
    safeReason("Expected HTTP 200; observed HTTP 5000 injected"),
  ).toContain("Configured assertion");
});
