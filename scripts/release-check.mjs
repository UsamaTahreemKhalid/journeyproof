import { mkdir, writeFile } from "node:fs/promises";
import { npm } from "./lib/process.mjs";
import { preflightPolicy } from "./lib/preflight.mjs";
import { fingerprints } from "./lib/fingerprints.mjs";
const directory = ".journeyproof/release-check";
await mkdir(directory, { recursive: true, mode: 0o700 });
const result = {
  schemaVersion: 1,
  status: "running",
  publicationAuthorized: false,
  checks: [],
};
await writeFile(
  `${directory}/manifest.json`,
  JSON.stringify(result, null, 2) + "\n",
  { mode: 0o600 },
);
try {
  await preflightPolicy();
  const before = await fingerprints(process.cwd(), false);
  let ci;
  try {
    ci = await npm(["run", "ci"], {
      timeout: 900000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    await writeFile(
      `${directory}/ci.log`,
      String(error.stdout ?? "") + String(error.stderr ?? ""),
      { mode: 0o600 },
    );
    throw error;
  }
  await writeFile(`${directory}/ci.log`, ci.stdout + ci.stderr, {
    mode: 0o600,
  });
  const { gateProofSchema, parseVerificationLog } =
    await import("../dist/index.js");
  result.checks.push("full ci including installed tarball acceptance");
  result.policy = JSON.parse(
    (await npm(["run", "check:release-policy", "--silent"])).stdout,
  );
  result.checks.push("private guards, non-publishing workflows and docs links");
  const audit = JSON.parse((await npm(["audit", "--json"])).stdout);
  result.advisories = audit.metadata.vulnerabilities;
  result.checks.push("dependency audit");
  const current = await fingerprints();
  if (current.sourceDigest !== before.sourceDigest)
    throw new Error("Validation inputs changed while gates ran");
  result.proof = gateProofSchema.parse({
    schemaVersion: 1,
    status: "passed",
    publicationAuthorized: false,
    ...current,
    completedAt: new Date().toISOString(),
    ci: parseVerificationLog(ci.stdout),
    advisories: audit.metadata.vulnerabilities.total,
  });
  result.status = "passed";
  result.meaning =
    "Validation passed; release remains blocked on owner decisions. Source/build digests identify only the documented gate inputs. No publishing, invitations or external mutations.";
} catch {
  result.status = "failed";
  result.meaning =
    "Validation failed or inputs changed; no beta/public release authorization.";
  process.exitCode = 1;
} finally {
  await writeFile(
    `${directory}/manifest.json`,
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result, null, 2));
}
