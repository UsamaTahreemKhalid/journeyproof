import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { npm } from "./lib/process.mjs";
import { preflightPolicy } from "./lib/preflight.mjs";
import { fingerprints } from "./lib/fingerprints.mjs";
const output = ".journeyproof/rc-prepare";
await mkdir(output, { recursive: true, mode: 0o700 });
if (process.argv.length !== 2)
  throw Error("rc:prepare accepts no publishing, approval or skip flags");
try {
  await mkdir(join(output, "lock"), { mode: 0o700 });
} catch {
  console.error(
    "Another RC preparation may be running. Inspect the local lock before manually removing a stale lock.",
  );
  process.exit(2);
}
const began = performance.now();
let staging;
try {
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify({ status: "running", publicationAuthorized: false }) + "\n",
    { mode: 0o600 },
  );
  await preflightPolicy();
  const result = await npm(["run", "beta:prepare"], {
    timeout: 900000,
    maxBuffer: 16 * 1024 * 1024,
  });
  await writeFile(join(output, "beta.log"), result.stdout + result.stderr, {
    mode: 0o600,
  });
  const beta = JSON.parse(
    await readFile(".journeyproof/beta-prepare/manifest.json", "utf8"),
  );
  if (beta.status !== "passed") throw Error("Current beta gate required");
  const {
    verifyBetaKit,
    planReleaseCandidate,
    stageReleaseCandidate,
    verifyReleaseCandidate,
  } = await import("../dist/index.js");
  const verified = await verifyBetaKit(
    process.cwd(),
    relative(process.cwd(), beta.directory).split("\\").join("/"),
  );
  const first = await fingerprints();
  if (
    first.sourceDigest !== verified.manifest.evidence.gate.sourceDigest ||
    first.buildDigest !== verified.manifest.evidence.gate.buildDigest
  )
    throw Error("Dirty build or stale source proof");
  // Rebuild once with the same source/toolchain; do not retry or normalize differing bytes.
  const rebuilt = await npm(["run", "build"]);
  await writeFile(
    join(output, "rebuild.log"),
    rebuilt.stdout + rebuilt.stderr,
    { mode: 0o600 },
  );
  const second = await fingerprints();
  if (
    first.sourceDigest !== second.sourceDigest ||
    first.buildDigest !== second.buildDigest
  )
    throw Error("Repeated build is different; candidate rejected");
  staging = await mkdtemp(resolve(output, "pack-"));
  const { packAudited } = await import("./lib/package-check.mjs");
  const { pack } = await packAudited(staging);
  const { sha256 } = await import("../dist/index.js");
  const packedAgain = sha256(await readFile(join(staging, pack.filename)));
  const betaFiles = new Map();
  for (const name of await readdir(verified.directory))
    betaFiles.set(name, await readFile(join(verified.directory, name)));
  const current = await fingerprints();
  const plan = planReleaseCandidate({
    betaFiles,
    ...current,
    repeatability: {
      firstBuild: first.buildDigest,
      secondBuild: second.buildDigest,
      firstArchive: verified.inspection.sha256,
      secondArchive: packedAgain,
    },
    createdAt: new Date().toISOString(),
    npm: (await npm(["--version"])).stdout.trim(),
  });
  const directory = await stageReleaseCandidate(process.cwd(), plan);
  await verifyReleaseCandidate(
    process.cwd(),
    relative(process.cwd(), directory).split("\\").join("/"),
  );
  const evidence = {
    status: "passed",
    publicationAuthorized: false,
    publicLaunch: "NO-GO",
    directory,
    archive: join(directory, plan.manifest.archive),
    sha256: plan.manifest.sha256,
    bytes: plan.manifest.bytes,
    elapsedMs: performance.now() - began,
  };
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify(evidence, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await writeFile(
    join(output, "failure.log"),
    String(error.message ?? "Validation failed") + "\n",
    { mode: 0o600 },
  );
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify({ status: "failed", publicationAuthorized: false }) + "\n",
    { mode: 0o600 },
  );
  console.error(
    "RC preparation failed; inspect local gate/rebuild/package evidence. No launch authorization.",
  );
  process.exitCode = 1;
} finally {
  if (staging) await rm(staging, { recursive: true, force: true });
  await rm(join(output, "lock"), { recursive: true, force: true });
}
