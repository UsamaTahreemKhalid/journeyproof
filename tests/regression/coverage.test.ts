import { it, expect } from "vitest";
import {
  workflowCoverage,
  coverageTable,
} from "../../src/regression/coverage.js";
import { journey, checksum, source } from "./fixtures.js";
it("counts observations, explicit assertion outcomes and unvisited links with visible denominators", () => {
  const good = source(),
    bad = source();
  bad.run.id = "1793730000001-abcd1234";
  bad.observations!.runId = bad.run.id;
  const route = { key: "route-guide", path: "/guide", basis: "exact" as const };
  good.observations!.events.push({
    seq: 99,
    type: "link",
    atMs: 30,
    pageId: "page-1",
    target: route,
  });
  bad.run.status = "failed";
  bad.run.steps[6]!.status = "failed";
  bad.run.steps[7]!.status = "skipped";
  bad.observations!.events = bad.observations!.events.slice(0, 7);
  bad.observations!.events[6]!.outcome = "failed";
  const report = workflowCoverage(journey, checksum, [good, bad]);
  expect(report.reached).toEqual({ numerator: 8, denominator: 8 });
  expect(report.asserted).toEqual({ numerator: 4, denominator: 8 });
  expect(report.runs[0]).toMatchObject({
    declared: 8,
    reached: 8,
    asserted: 4,
    passed: 4,
    failed: 0,
    notReached: 0,
    unknown: 0,
    supported: 8,
    linkedUnvisited: 1,
  });
  expect(report.runs[1]).toMatchObject({
    declared: 8,
    reached: 7,
    asserted: 3,
    passed: 2,
    failed: 1,
    notReached: 1,
    unknown: 0,
    supported: 6,
  });
  expect(coverageTable(report)).toContain("executed assertions 4/8");
  expect(JSON.stringify(report)).not.toContain("private-literal");
  good.observations!.events.push({
    seq: 100,
    type: "navigation",
    atMs: 31,
    pageId: "page-1",
    route,
  });
  expect(
    workflowCoverage(journey, checksum, [good]).runs[0]!.linkedUnvisited,
  ).toBe(0);
});
it("keeps missing observations unknown and action failures distinct from assertion passes", () => {
  const old = source();
  delete old.observations;
  const report = workflowCoverage(journey, checksum, [old]);
  expect(report.runs[0]).toMatchObject({
    reached: 0,
    asserted: 0,
    passed: 0,
    unknown: 8,
    linkedUnvisited: null,
    incomplete: true,
  });
  expect(coverageTable(report)).toContain("unknown");
  const fail = source();
  fail.run.steps[0]!.status = "failed";
  fail.observations!.events[0]!.outcome = "failed";
  expect(workflowCoverage(journey, checksum, [fail]).runs[0]).toMatchObject({
    failed: 1,
    passed: 4,
  });
  fail.run.http = [];
  expect(workflowCoverage(journey, checksum, [fail]).runs[0]!.supported).toBe(
    6,
  );
});
it("rejects incompatible, empty, excessive and repeated source sets", () => {
  const s = source();
  for (const sources of [[], [s, s], Array.from({ length: 21 }, () => s)])
    expect(() => workflowCoverage(journey, checksum, sources)).toThrow(
      "distinct",
    );
  expect(() => workflowCoverage(journey, "b".repeat(64), [s])).toThrow(
    "checksum",
  );
});
