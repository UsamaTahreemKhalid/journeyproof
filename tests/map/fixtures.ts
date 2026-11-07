import type { MapSource } from "../../src/map/build.js";
import { sampleRun } from "../helpers.js";
import { observationsSchema } from "../../src/observations/schema.js";
import { routeFor } from "../../src/map/normalize.js";
const origin = "http://127.0.0.1:4173";
export function modelSource(broken = false): MapSource {
  const run = sampleRun();
  if (broken) run.id = "1793730000001-abcd1234";
  run.status = broken ? "failed" : "passed";
  run.steps = [
    { ...run.steps[0]!, id: "open", action: "goto" },
    { ...run.steps[0]!, id: "fill", action: "fill" },
    {
      ...run.steps[0]!,
      id: "approve",
      action: "expectResponse",
      status: broken ? "failed" : "passed",
      ...(broken
        ? {
            reason:
              "Expected HTTP 200; observed HTTP 500 for POST /api/approve",
          }
        : {}),
    },
    {
      ...run.steps[0]!,
      id: "verify",
      action: "expectText",
      status: broken ? "skipped" : "passed",
    },
  ];
  run.http = [
    {
      method: "POST",
      url: origin + "/api/approve?token=hidden",
      status: broken ? 500 : 200,
      timeMs: 4,
    },
  ];
  const route = routeFor("/admissions", origin)!;
  return {
    run,
    evidence: [],
    observations: observationsSchema.parse({
      schemaVersion: 1,
      runId: run.id,
      flowName: "unit-workflow",
      flowFingerprint: "a".repeat(20),
      role: "admissions-officer",
      truncated: false,
      declarations: run.steps.map((step) => ({ stepId: step.id })),
      events: [
        {
          seq: 0,
          atMs: 1,
          type: "navigation",
          pageId: "page-1",
          stepId: "open",
          route,
        },
        {
          seq: 1,
          atMs: 2,
          type: "link",
          pageId: "page-1",
          route,
          target: routeFor("/guide", origin)!,
        },
        ...run.steps
          .filter((s) => s.status !== "skipped")
          .map((step, i) => ({
            seq: i + 2,
            atMs: i + 3,
            type: "step",
            pageId: "page-1",
            stepId: step.id,
            route,
            before: route,
            outcome: step.status,
          })),
      ],
    }),
  };
}
