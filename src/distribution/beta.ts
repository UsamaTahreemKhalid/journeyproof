import { z } from "zod";
import { readCandidate, stageCandidate } from "./files.js";
import { InputError } from "../shared/errors.js";
import { inspectArchive, sha256 } from "./archive.js";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const coverage = z.strictObject({
  statements: z.number().min(85).max(100),
  branches: z.number().min(80).max(100),
  functions: z.number().min(85).max(100),
  lines: z.number().min(85).max(100),
});
export const gateProofSchema = z.strictObject({
  schemaVersion: z.literal(1),
  status: z.literal("passed"),
  publicationAuthorized: z.literal(false),
  sourceDigest: hash,
  buildDigest: hash,
  completedAt: z.iso.datetime(),
  ci: z.strictObject({
    files: z.number().int().positive(),
    tests: z.number().int().positive(),
    failed: z.literal(0),
    skipped: z.literal(0),
    e2e: z.number().int().positive(),
    coverage,
  }),
  advisories: z.literal(0),
});
export type GateProof = z.infer<typeof gateProofSchema>;
export const rehearsalProofSchema = z.strictObject({
  status: z.literal("passed"),
  platform: z.enum(["linux", "darwin", "win32"]),
  node: z.string().regex(/^v24\./),
  elapsedMs: z.number().nonnegative(),
  healthyRunId: z.string().regex(/^\d{13}-[a-f0-9]{8}$/),
  brokenRunId: z.string().regex(/^\d{13}-[a-f0-9]{8}$/),
  mcpRunVerified: z.literal(true),
  viewerVerified: z.literal(true),
});
export function parseVerificationLog(log: string) {
  const clean = log.replace(
    new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"),
    "",
  );
  if (
    /^\s*(?:Test Files|Tests).*\b(?:failed|skipped|flaky)\b|^\s*\d+ (?:failed|skipped|flaky)\b/m.test(
      clean,
    )
  )
    throw new InputError(
      "Failed, skipped or flaky verification cannot authorize a kit",
    );
  const tests = /^\s*Tests\s+(\d+) passed \((\d+)\)\s*$/m.exec(clean);
  const files = /^\s*Test Files\s+(\d+) passed \((\d+)\)\s*$/m.exec(clean);
  const e2e = /^\s*(\d+) passed \([0-9.]+s\)\s*$/m.exec(clean);
  if (
    !tests ||
    !files ||
    !e2e ||
    tests[1] !== tests[2] ||
    files[1] !== files[2]
  )
    throw new InputError(
      "Cannot prove complete CI success from the observed test summary",
    );
  const percentage = (name: string) => {
    const match = new RegExp(name + "\\s*:\\s*([0-9.]+)%").exec(clean);
    if (!match) throw new InputError("Coverage summary missing");
    return Number(match[1]);
  };
  return gateProofSchema.shape.ci.parse({
    files: Number(files[1]),
    tests: Number(tests[1]),
    failed: 0,
    skipped: 0,
    e2e: Number(e2e[1]),
    coverage: {
      statements: percentage("Statements"),
      branches: percentage("Branches"),
      functions: percentage("Functions"),
      lines: percentage("Lines"),
    },
  });
}
export function betaDocuments(version: string, playwright: string) {
  const archive = `journeyproof-${version}.tgz`;
  return {
    "INSTALL.md": `# Local beta installation — approval required\n\nDo not share until the owner approves recipients, terms and channel. Requires Node >=24.11 <25 and matching Chromium prerequisites. Archive recipients can inspect/copy the shipped JavaScript. No copying-prevention claim.\n\nFrom this kit folder, first verify SHA256SUMS.txt using VERIFY.md. Use Bash on the tested Linux host and an unused sibling project folder, keeping this kit unchanged; no global install:\n\n\`\`\`bash\nJP_BETA_ARCHIVE="$PWD/${archive}"\nmkdir ../journeyproof-consumer\ncd ../journeyproof-consumer\nnpm init -y\nnpm pkg set type=module\nnpm install --ignore-scripts --no-audit --no-fund "$JP_BETA_ARCHIVE"\nnode node_modules/journeyproof/dist/cli.js --help\nnode node_modules/journeyproof/dist/cli.js doctor --no-browser\nnpm install --save-dev --ignore-scripts @playwright/test@${playwright}\nnode node_modules/playwright/cli.js install chromium\nnode node_modules/journeyproof/dist/cli.js doctor --json\nnode node_modules/journeyproof/examples/verify-demo.mjs\n\`\`\`\n\nLinux may need the explicit --with-deps browser option and system privileges. Doctor never installs anything. Installation/downloads need network; local reports do not. The demo uses synthetic data, fresh loopback ports and one existing engine. It must pass healthy and fail approval with HTTP 500 using identical generated test bytes. Save its printed workspace and IDs. Under-ten-minute onboarding is a target, not a cold-machine guarantee. macOS/Windows are configured, not observed.\n`,
    "VERIFY.md": `# Integrity and evidence\n\nA checksum proves byte integrity only when received through a trusted channel; it is not publisher identity or distribution approval. From this kit directory:\n\n\`\`\`bash\nnode --input-type=module -e 'import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import assert from"node:assert/strict";const expected=readFileSync("SHA256SUMS.txt","utf8").trim().split(/\\s+/);assert.equal(createHash("sha256").update(readFileSync(expected[1])).digest("hex"),expected[0]);console.log("Checksum verified");'\n\`\`\`\n\nAfter INSTALL.md, inspect the printed generated spec, healthy/broken reports, screenshot, minimized trace and comparison HTML. Map observation is not verification; a clicked button alone is not a business assertion. MCP command is node node_modules/journeyproof/dist/cli.js mcp from consumer, with JOURNEYPROOF_WORKSPACE_ROOT set to the demo's printed workspace and approved relative FLOW_ROOT examples/admissions-demo/journeys. Silence before a real client is normal. CLI-only checks are not an agent conversation. SDK execution and Skill references are checked by the local development rehearsal; no independent human feedback is implied.\n`,
    "UNINSTALL.md":
      "# Uninstall and retention\n\nStop any manually started demo/client using Ctrl+C. The automated demo closes its servers and browsers in finally. No global install, daemon or shell-profile change is made. From consumer run npm uninstall journeyproof, or review and remove only the dedicated consumer folder you created. That folder contains .journeyproof synthetic evidence and node_modules. Keep nothing without a reason; review before sharing. Do not delete an arbitrary application's reports. Cleanup is manual and opt-in, never an automatic purge. Remove any host registration you explicitly added using that host's documented remove command. A hard kill can prevent cleanup; inspect your own process list if interrupted.\n",
    "KNOWN_LIMITATIONS.md":
      "# Known limits\n\nPrivate prototype, owner decisions pending. Chromium and the existing seven YAML actions only; no autonomous discovery, remote generated/MCP execution, select/check/title/value actions or RBAC proof. Fedora/Linux local tests use an unofficial Ubuntu browser fallback. macOS/Windows/hosted CI remain unobserved. No independent external tester has participated. A new npm consumer is not a cold OS. Unknown pixel/encoded private data can remain in arbitrary screenshots; synthetic targets only, manually review evidence. Traces omit DOM/network payloads. Local filesystem is trusted; races, hard kills and indefinite retention remain risks. Source code stays private, but this compiled archive is inspectable. No hosting, telemetry, publishing or invitations are performed.\n",
    "BETA_OWNER_APPROVAL_REQUIRED.txt":
      "LOCAL VALIDATION ONLY. Apache-2.0 source licensing does not authorize this release workflow to distribute or publish. Distribution is NOT authorized. No tester selected or contacted. Owner must choose distribution, recipients, legal terms, channel, expiry, data restrictions and support. No publication, upload, invitation, license or visibility change is authorized.\n",
  };
}
export function planBetaKit(input: {
  archive: Uint8Array;
  gate: unknown;
  rehearsal: unknown;
  sourceDigest: string;
  buildDigest: string;
  commit?: string;
  node: string;
  platform: string;
}) {
  const gate = gateProofSchema.safeParse(input.gate),
    rehearsal = rehearsalProofSchema.safeParse(input.rehearsal);
  if (!gate.success || !rehearsal.success)
    throw new InputError(
      "Current successful release and installed rehearsal evidence required",
    );
  if (
    gate.data.sourceDigest !== input.sourceDigest ||
    gate.data.buildDigest !== input.buildDigest
  )
    throw new InputError("Release evidence is stale; run release:check again");
  const inspected = inspectArchive(input.archive);
  const version = inspected.metadata.version,
    archive = `journeyproof-${version}.tgz`;
  const documents = betaDocuments(
    version,
    inspected.metadata.dependencies.playwright!,
  );
  const evidence = { gate: gate.data, rehearsal: rehearsal.data };
  const kitId = sha256(inspected.sha256 + JSON.stringify(evidence)).slice(
    0,
    20,
  );
  const files = [
    {
      name: archive,
      bytes: input.archive.byteLength,
      sha256: inspected.sha256,
    },
    ...Object.entries(documents).map(([name, body]) => ({
      name,
      bytes: Buffer.byteLength(body),
      sha256: sha256(body),
    })),
  ];
  const manifest = {
    schemaVersion: 1 as const,
    version,
    kitId,
    distributionAuthorized: false as const,
    externalTesters: 0 as const,
    archive,
    files,
    packageFiles: inspected.files.map(({ path, size }) => ({ path, size })),
    sourceState:
      "Working-file digests; commit alone does not attest uncommitted changes",
    commit:
      input.commit && /^[a-f0-9]{40}$/.test(input.commit)
        ? input.commit
        : undefined,
    node: input.node,
    playwright: inspected.metadata.dependencies.playwright,
    platform: input.platform,
    redactionChecks: {
      manifest: true,
      text: true,
      pngPrivacy: "curated-manual-review-not-universal",
    },
    testSummary: gate.data.ci,
    testedOn: [
      {
        platform: rehearsal.data.platform,
        node: rehearsal.data.node,
        scope:
          "automated installed CLI/MCP/generated-spec/static-viewer rehearsal",
      },
    ],
    configuredFor: ["ubuntu-latest", "macos-latest", "windows-latest"],
    evidence,
    independentFeedback: "NOT TESTED",
  };
  return { manifest, archive, documents, bytes: input.archive };
}
export async function stageBetaKit(
  root: string,
  plan: ReturnType<typeof planBetaKit>,
) {
  const payload = new Map<string, Buffer>(
    Object.entries({
      ...plan.documents,
      [plan.archive]: plan.bytes,
      "SHA256SUMS.txt": `${plan.manifest.files[0]!.sha256}  ${plan.archive}\n`,
      "beta-manifest.json": JSON.stringify(plan.manifest, null, 2) + "\n",
    }).map(([name, body]) => [name, Buffer.from(body)]),
  );
  validateBetaFiles(plan.manifest, payload);
  return stageCandidate(
    root,
    `artifacts/beta/journeyproof-${plan.manifest.version}-${plan.manifest.kitId}`,
    payload,
  );
}

const artifactName = z.enum([
  "INSTALL.md",
  "VERIFY.md",
  "UNINSTALL.md",
  "KNOWN_LIMITATIONS.md",
  "BETA_OWNER_APPROVAL_REQUIRED.txt",
]);
export const betaManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)
      .max(50),
    kitId: z.string().regex(/^[a-f0-9]{20}$/),
    distributionAuthorized: z.literal(false),
    externalTesters: z.literal(0),
    archive: z.string().regex(/^journeyproof-[a-zA-Z0-9.-]+\.tgz$/),
    files: z
      .array(
        z.strictObject({
          name: z.string().max(100),
          bytes: z
            .number()
            .int()
            .min(0)
            .max(3 * 1024 * 1024),
          sha256: hash,
        }),
      )
      .length(6),
    evidence: z.strictObject({
      gate: gateProofSchema,
      rehearsal: rehearsalProofSchema,
    }),
  })
  .passthrough();
export function validateBetaFiles(input: unknown, files: Map<string, Buffer>) {
  const parsed = betaManifestSchema.safeParse(input);
  if (!parsed.success)
    throw new InputError("Invalid or unsuccessful beta manifest");
  const manifest = parsed.data;
  if (manifest.archive !== `journeyproof-${manifest.version}.tgz`)
    throw new InputError("Archive/version mismatch");
  const allowed = new Set<string>([manifest.archive, ...artifactName.options]);
  if (
    new Set(manifest.files.map((f) => f.name)).size !== 6 ||
    manifest.files.some((f) => !allowed.has(f.name))
  )
    throw new InputError("Unexpected beta artifact name");
  if (
    files.size !== 8 ||
    [...files.keys()].some(
      (name) =>
        !allowed.has(name) &&
        !["SHA256SUMS.txt", "beta-manifest.json"].includes(name),
    )
  )
    throw new InputError("Unexpected or missing kit file");
  for (const file of manifest.files) {
    const bytes = files.get(file.name);
    if (!bytes || bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
      throw new InputError("Beta artifact integrity mismatch");
  }
  const archive = files.get(manifest.archive)!;
  const inspected = inspectArchive(
    archive,
    manifest.files.find((f) => f.name === manifest.archive)!.sha256,
  );
  if (inspected.metadata.version !== manifest.version)
    throw new InputError("Package version mismatch");
  const checksum = files.get("SHA256SUMS.txt")!.toString("utf8");
  if (checksum !== `${inspected.sha256}  ${manifest.archive}\n`)
    throw new InputError("Checksum document mismatch");
  const expected = sha256(
    inspected.sha256 + JSON.stringify(manifest.evidence),
  ).slice(0, 20);
  if (expected !== manifest.kitId)
    throw new InputError("Kit provenance mismatch");
  return { manifest, inspection: inspected };
}
export async function verifyBetaKit(root: string, path: string) {
  if (!/^artifacts\/beta\/journeyproof-[a-zA-Z0-9.-]+-[a-f0-9]{20}$/.test(path))
    throw new InputError(
      "Choose a staged relative artifacts/beta kit directory",
    );
  const { directory, files } = await readCandidate(root, path, 8);
  let manifest;
  try {
    manifest = JSON.parse(files.get("beta-manifest.json")!.toString("utf8"));
  } catch {
    throw new InputError("Invalid beta manifest JSON");
  }
  return { ...validateBetaFiles(manifest, files), directory };
}
