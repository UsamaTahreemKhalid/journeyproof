import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { requiredAssets } from "../../src/distribution/audit.js";
import type { GateProof } from "../../src/distribution/beta.js";
export function tarball(
  entries: Map<string, Buffer>,
  options: {
    type?: number;
    mode?: number;
    prefix?: string;
    extra?: Buffer;
  } = {},
) {
  const blocks: Buffer[] = [];
  for (const [path, bytes] of entries) {
    const h = Buffer.alloc(512);
    h.write((options.prefix ?? "package/") + path, 0, 100);
    const octal = (value: number, offset: number, width: number) =>
      h.write(value.toString(8).padStart(width - 1, "0") + "\0", offset, width);
    octal(options.mode ?? (path === "dist/cli.js" ? 0o755 : 0o644), 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(bytes.length, 124, 12);
    octal(0, 136, 12);
    h.fill(32, 148, 156);
    h[156] = options.type ?? 48;
    h.write("ustar\0", 257, 6);
    const sum = h.reduce((a, b) => a + b, 0);
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    blocks.push(h, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  return gzipSync(
    Buffer.concat([
      ...blocks,
      Buffer.alloc(1024),
      options.extra ?? Buffer.alloc(0),
    ]),
  );
}
export function payload() {
  const files = new Map(
    requiredAssets.map((path) => [
      path,
      path.endsWith(".png")
        ? readFileSync("docs/assets/demo-failure.png")
        : Buffer.from("Synthetic safe asset\n"),
    ]),
  );
  for (const name of ["LICENSE", "NOTICE"]) files.set(name, readFileSync(name));
  files.set(
    "package.json",
    Buffer.from(
      JSON.stringify({
        name: "journeyproof",
        version: "0.1.0",
        private: true,
        license: "Apache-2.0",
        engines: { node: ">=24.11.0 <25" },
        dependencies: { playwright: "1.64.1", prettier: "3.9.10" },
        devDependencies: {
          "@playwright/test": "1.64.1",
          typescript: "6.0.3",
          "@types/node": "24.19.2",
        },
      }),
    ),
  );
  return files;
}
export const digest = "a".repeat(64),
  build = "b".repeat(64);
export const gate: GateProof = {
  schemaVersion: 1,
  status: "passed",
  publicationAuthorized: false,
  sourceDigest: digest,
  buildDigest: build,
  completedAt: "2026-11-05T00:00:00.000Z",
  ci: {
    files: 24,
    tests: 141,
    failed: 0,
    skipped: 0,
    e2e: 6,
    coverage: {
      statements: 97.25,
      branches: 93.71,
      functions: 95.6,
      lines: 97.71,
    },
  },
  advisories: 0,
};
export const rehearsal = {
  status: "passed",
  platform: "linux",
  node: "v24.22.0",
  elapsedMs: 1000,
  healthyRunId: "1793730000000-abcd1234",
  brokenRunId: "1793730000001-abcd1234",
  mcpRunVerified: true,
  viewerVerified: true,
};
export const log =
  "Test Files 24 passed (24)\nTests 141 passed (141)\n6 passed (10.5s)\nStatements : 97.25%\nBranches : 93.71%\nFunctions : 95.60%\nLines : 97.71%\n";
