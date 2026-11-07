import { z } from "zod";
import { validateBetaFiles } from "./beta.js";
import { sha256 } from "./archive.js";
import { readCandidate, stageCandidate } from "./files.js";
import { InputError } from "../shared/errors.js";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const rcRepeatabilitySchema = z.strictObject({
  firstBuild: hash,
  secondBuild: hash,
  firstArchive: hash,
  secondArchive: hash,
});
const rcManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  channel: z.literal("rc"),
  name: z.literal("journeyproof"),
  version: z.string().regex(/^\d+\.\d+\.\d+-rc\.[1-9]\d*$/),
  archive: z.string().max(100),
  sha256: hash,
  bytes: z.number().int().positive(),
  unpackedBytes: z.number().int().positive(),
  packageFiles: z
    .array(
      z.strictObject({
        path: z.string().max(200),
        bytes: z.number().int().nonnegative(),
        sha256: hash,
      }),
    )
    .min(1)
    .max(200),
  createdAt: z.iso.datetime(),
  commit: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .optional(),
  sourceState: z.literal(
    "Working-file digests; commit alone does not attest uncommitted changes",
  ),
  sourceDigest: hash,
  buildDigest: hash,
  betaKitId: z.string().regex(/^[a-f0-9]{20}$/),
  toolchain: z.strictObject({
    node: z.string().regex(/^v24\./),
    npm: z.string().regex(/^\d+\.\d+\.\d+$/),
    playwright: z.string().max(50),
    typescript: z.string().max(50),
  }),
  repeatability: rcRepeatabilitySchema,
  testedOn: z.strictObject({
    platform: z.enum(["linux", "darwin", "win32"]),
    node: z.string().regex(/^v24\./),
  }),
  configuredOnly: z.tuple([
    z.literal("ubuntu-latest"),
    z.literal("macos-latest"),
    z.literal("windows-latest"),
  ]),
  publicationAuthorized: z.literal(false),
  publicLaunch: z.literal("NO-GO"),
  externalTesters: z.literal(0),
});
export function planReleaseCandidate(input: {
  betaFiles: Map<string, Buffer>;
  sourceDigest: string;
  buildDigest: string;
  repeatability: unknown;
  createdAt: string;
  npm: string;
}) {
  let raw;
  try {
    raw = JSON.parse(
      input.betaFiles.get("beta-manifest.json")!.toString("utf8"),
    );
  } catch {
    throw new InputError("Missing or invalid beta evidence");
  }
  const { manifest: beta, inspection } = validateBetaFiles(
    raw,
    input.betaFiles,
  );
  const gate = beta.evidence.gate;
  const repetition = rcRepeatabilitySchema.parse(input.repeatability);
  if (
    input.sourceDigest !== gate.sourceDigest ||
    input.buildDigest !== gate.buildDigest
  )
    throw new InputError("RC evidence is stale or build assets are dirty");
  if (
    repetition.firstBuild !== gate.buildDigest ||
    repetition.secondBuild !== gate.buildDigest ||
    repetition.firstArchive !== inspection.sha256 ||
    repetition.secondArchive !== inspection.sha256
  )
    throw new InputError(
      "Repeated build/package bytes do not match the gated candidate",
    );
  const meta = inspection.metadata;
  for (const required of [
    "docs/INSTALLATION.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "docs/FAQ.md",
  ])
    if (!inspection.entries.has(required))
      throw new InputError("Critical RC documentation missing");
  const manifest = rcManifestSchema.parse({
    schemaVersion: 1,
    channel: "rc",
    name: meta.name,
    version: meta.version,
    archive: beta.archive,
    sha256: inspection.sha256,
    bytes: input.betaFiles.get(beta.archive)!.length,
    unpackedBytes: inspection.audit.unpackedBytes,
    packageFiles: [...inspection.entries].map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: sha256(bytes),
    })),
    createdAt: input.createdAt,
    ...(typeof beta.commit === "string" ? { commit: beta.commit } : {}),
    sourceState:
      "Working-file digests; commit alone does not attest uncommitted changes",
    sourceDigest: gate.sourceDigest,
    buildDigest: gate.buildDigest,
    betaKitId: beta.kitId,
    toolchain: {
      node: beta.evidence.rehearsal.node,
      npm: input.npm,
      playwright: meta.dependencies.playwright,
      typescript: meta.devDependencies.typescript,
    },
    repeatability: repetition,
    testedOn: {
      platform: beta.evidence.rehearsal.platform,
      node: beta.evidence.rehearsal.node,
    },
    configuredOnly: ["ubuntu-latest", "macos-latest", "windows-latest"],
    publicationAuthorized: false,
    publicLaunch: "NO-GO",
    externalTesters: 0,
  });
  const files = new Map(input.betaFiles);
  files.set(
    "rc-manifest.json",
    Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
  );
  return { manifest, files };
}
export function validateReleaseCandidate(files: Map<string, Buffer>) {
  if (files.size !== 9) throw new InputError("Unexpected or missing RC file");
  let parsed;
  try {
    parsed = rcManifestSchema.parse(
      JSON.parse(files.get("rc-manifest.json")!.toString("utf8")),
    );
  } catch {
    throw new InputError("Invalid RC manifest");
  }
  const betaFiles = new Map(files);
  betaFiles.delete("rc-manifest.json");
  const expected = planReleaseCandidate({
    betaFiles,
    sourceDigest: parsed.sourceDigest,
    buildDigest: parsed.buildDigest,
    repeatability: parsed.repeatability,
    createdAt: parsed.createdAt,
    npm: parsed.toolchain.npm,
  });
  if (JSON.stringify(parsed) !== JSON.stringify(expected.manifest))
    throw new InputError("RC manifest does not match actual package/evidence");
  return expected.manifest;
}
export async function stageReleaseCandidate(
  root: string,
  plan: ReturnType<typeof planReleaseCandidate>,
) {
  const manifest = validateReleaseCandidate(plan.files);
  return stageCandidate(
    root,
    `artifacts/rc/journeyproof-${manifest.version}-${manifest.betaKitId}`,
    plan.files,
  );
}
export async function verifyReleaseCandidate(root: string, path: string) {
  if (
    !/^artifacts\/rc\/journeyproof-\d+\.\d+\.\d+-rc\.[1-9]\d*-[a-f0-9]{20}$/.test(
      path,
    )
  )
    throw new InputError("Choose a staged relative artifacts/rc directory");
  const { directory, files } = await readCandidate(root, path, 9);
  const manifest = validateReleaseCandidate(files);
  if (!path.endsWith(`journeyproof-${manifest.version}-${manifest.betaKitId}`))
    throw new InputError("RC directory/provenance mismatch");
  return { directory, manifest };
}
