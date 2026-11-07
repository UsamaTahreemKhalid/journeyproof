import { performance } from "node:perf_hooks";
import { mkdir, mkdtemp, readFile, writeFile, rm, cp } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { npm } from "./lib/process.mjs";
import { fingerprints } from "./lib/fingerprints.mjs";
const start = performance.now();
if (process.argv.length !== 2)
  throw new Error("beta:prepare accepts no skip/approval/publishing flags");
await mkdir(".journeyproof/beta-prepare", { recursive: true, mode: 0o700 });
await writeFile(
  ".journeyproof/beta-prepare/manifest.json",
  JSON.stringify({ status: "running", distributionAuthorized: false }) + "\n",
  { mode: 0o600 },
);
let staging;
try {
  const release = await npm(["run", "release:check"], {
    timeout: 900000,
    maxBuffer: 16 * 1024 * 1024,
  });
  await writeFile(
    ".journeyproof/beta-prepare/release.log",
    release.stdout + release.stderr,
    { mode: 0o600 },
  );
  const gate = JSON.parse(
    await readFile(".journeyproof/release-check/manifest.json", "utf8"),
  );
  if (gate.status !== "passed")
    throw new Error("Successful current release gate required");
  const { packAudited, verifyPackage } =
    await import("./lib/package-check.mjs");
  const { planBetaKit, stageBetaKit, verifyBetaKit } =
    await import("../dist/index.js");
  const current = await fingerprints();
  if (
    current.sourceDigest !== gate.proof.sourceDigest ||
    current.buildDigest !== gate.proof.buildDigest
  )
    throw new Error("Release evidence is stale");
  staging = await mkdtemp(resolve(".journeyproof/beta-prepare/staging-"));
  const { pack } = await packAudited(staging);
  const archive = join(staging, pack.filename);
  const rehearsal = await verifyPackage({
    archive,
    keep: true,
    temporaryPrefix: "journeyproof bêta ",
  });
  await writeFile(
    ".journeyproof/beta-prepare/rehearsal.json",
    JSON.stringify(rehearsal, null, 2) + "\n",
    { mode: 0o600 },
  );
  let commit;
  try {
    commit = (
      await promisify(execFile)("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      })
    ).stdout.trim();
  } catch {
    /* Non-git local copies may omit commit metadata. */
  }
  const plan = planBetaKit({
    archive: await readFile(archive),
    gate: gate.proof,
    rehearsal: {
      status: rehearsal.status,
      platform: rehearsal.platform,
      node: rehearsal.node,
      elapsedMs: rehearsal.harnessDurationMs,
      healthyRunId: rehearsal.demo.healthy.runId,
      brokenRunId: rehearsal.demo.broken.runId,
      mcpRunVerified: rehearsal.mcpRuns.length === 2,
      viewerVerified: rehearsal.demo.viewer.loaded,
    },
    ...(await fingerprints()),
    commit,
    node: process.version,
    platform: process.platform,
  });
  const directory = await stageBetaKit(process.cwd(), plan);
  await verifyBetaKit(
    process.cwd(),
    relative(process.cwd(), directory).split("\\").join("/"),
  );
  const result = {
    status: "passed",
    distributionAuthorized: false,
    externalTesters: 0,
    directory,
    archive: join(directory, plan.archive),
    sha256: plan.manifest.files[0].sha256,
    rehearsal: rehearsal.project,
    elapsedMs: performance.now() - start,
  };
  await writeFile(
    ".journeyproof/beta-prepare/manifest.json",
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  await cp(
    ".journeyproof/package-smoke/manifest.json",
    ".journeyproof/beta-prepare/retained-rehearsal.json",
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    "Beta preparation failed; no distribution authorization. Check the local release/package/rehearsal logs.",
  );
  await writeFile(
    ".journeyproof/beta-prepare/failure.log",
    String(error instanceof Error ? error.message : "Validation failed") + "\n",
    { mode: 0o600 },
  );
  await writeFile(
    ".journeyproof/beta-prepare/manifest.json",
    JSON.stringify({ status: "failed", distributionAuthorized: false }) + "\n",
    { mode: 0o600 },
  );
  process.exitCode = 1;
} finally {
  if (staging) await rm(staging, { recursive: true, force: true });
}
