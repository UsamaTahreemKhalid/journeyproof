import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunResult } from "../src/shared/types.js";
export async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "journeyproof-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
export function sampleRun(): RunResult {
  return {
    schemaVersion: 1,
    id: "1793730000000-abcd1234",
    name: "Example",
    status: "passed",
    startedAt: "2026-11-04T00:00:00.000Z",
    durationMs: 10,
    metadata: {
      toolVersion: "0.1.0",
      nodeVersion: "v24",
      hostname: "127.0.0.1",
      flowFile: "sample.yaml",
      checksum: "abc",
    },
    reproduction: "journeyproof run --flow sample.yaml",
    steps: [
      {
        id: "open",
        action: "goto",
        status: "passed",
        durationMs: 10,
        expected: "Open page",
        observed: "Page opened",
      },
    ],
    http: [],
    errors: [],
    warnings: [],
  };
}
