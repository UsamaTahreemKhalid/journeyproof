import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { journeySchema, type Journey } from "../../src/config/schema.js";
import { WorkspacePolicy } from "../../src/mcp/policy.js";
import type { MapSource } from "../../src/map/build.js";
import { sampleRun, temp } from "../helpers.js";
export const checksum = "a".repeat(64);
export const journey: Journey = journeySchema.parse({
  schemaVersion: 1,
  name: "Synthetic test",
  role: "reviewer",
  steps: [
    { id: "open", action: "goto", path: "/login" },
    {
      id: "email",
      action: "fill",
      locator: { role: "textbox", name: "Email" },
      valueFromEnv: "DEMO_EMAIL",
    },
    {
      id: "literal",
      action: "fill",
      locator: { testId: "input" },
      value: "private-literal",
    },
    { id: "click", action: "click", locator: { role: "button", name: "Save" } },
    { id: "visible", action: "expectVisible", locator: { testId: "status" } },
    { id: "url", action: "expectUrl", path: "/admissions/*" },
    {
      id: "response",
      action: "expectResponse",
      locator: { role: "button", name: "Approve" },
      method: "POST",
      path: "/api/*",
      status: 200,
    },
    {
      id: "done",
      action: "expectText",
      locator: { role: "status", name: "Outcome" },
      text: "Approved",
    },
  ],
});
export function source(input = journey): MapSource {
  return {
    run: {
      ...sampleRun(),
      metadata: { ...sampleRun().metadata, checksum },
      steps: input.steps.map((s) => ({
        id: s.id,
        action: s.action,
        status: "passed",
        durationMs: 5,
        expected: "Configured",
        observed: "Completed",
      })),
      http: [
        {
          method: "POST",
          url: "http://127.0.0.1/api/1",
          status: 200,
          timeMs: 15,
        },
      ],
    },
    observations: {
      schemaVersion: 1,
      runId: sampleRun().id,
      flowName: "synthetic",
      role: input.role,
      flowFingerprint: "b".repeat(20),
      declarations: input.steps.map((s) => ({ stepId: s.id })),
      truncated: false,
      events: input.steps.map((s, i) => ({
        seq: i,
        type: "step",
        atMs: 20,
        startedAtMs: 10,
        pageId: "page-1",
        stepId: s.id,
        outcome: "passed",
      })),
    },
    evidence: [],
  };
}
export async function workspace(input = journey) {
  const t = await temp();
  await mkdir(join(t.dir, "flows"));
  const yaml = stringify(input);
  const hash = createHash("sha256").update(yaml).digest("hex");
  await writeFile(join(t.dir, "flows/test.yaml"), yaml);
  return { ...t, hash, policy: await WorkspacePolicy.create(t.dir, "flows") };
}
export async function saveSource(
  root: string,
  input: MapSource,
  flowChecksum: string,
  link = true,
) {
  input.run.metadata.checksum = flowChecksum;
  const dir = join(root, ".journeyproof/runs", input.run.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "run.json"), JSON.stringify(input.run));
  if (input.observations)
    await writeFile(
      join(dir, "observations.json"),
      JSON.stringify(input.observations),
    );
  if (link)
    await writeFile(
      join(dir, "source.json"),
      JSON.stringify({
        schemaVersion: 1,
        flowPath: "flows/test.yaml",
        checksum: flowChecksum,
      }),
    );
  return dir;
}
