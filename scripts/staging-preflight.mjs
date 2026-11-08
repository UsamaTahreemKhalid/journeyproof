import { readFile, access } from "node:fs/promises";
import { authorizeStaging } from "../src/distribution/staging.ts";
const env = process.env;
if (env.GITHUB_RUN_ATTEMPT !== "1")
  throw new Error("Rerun attempts require a fresh dispatch and approval");
if (env.NODE_AUTH_TOKEN || env.NPM_TOKEN)
  throw new Error("npm tokens are not allowed in the staging job");
try {
  await access(".npmrc");
  throw new Error("Project npm configuration is not allowed for staging");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const base = "https://api.github.com/repos/UsamaTahreemKhalid/journeyproof";
async function json(url) {
  const response = await globalThis.fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "journeyproof-release-check",
    },
    signal: globalThis.AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(`Read-only verification failed: HTTP ${response.status}`);
  return response.json();
}
const [environmentConfig, approvals, branch, branchPolicies] =
  await Promise.all([
    json(`${base}/environments/npm-release`),
    json(
      `${base}/actions/runs/${encodeURIComponent(env.GITHUB_RUN_ID)}/approvals`,
    ),
    json(`${base}/branches/main`),
    json(
      `${base}/environments/npm-release/deployment-branch-policies?per_page=100`,
    ),
  ]);
if (branch.protected !== true) throw new Error("Main is not protected");
const response = await globalThis.fetch(
  "https://registry.npmjs.org/journeyproof/0.1.0-rc.1",
  { signal: globalThis.AbortSignal.timeout(10000) },
);
const packageResponse = await globalThis.fetch(
  "https://registry.npmjs.org/journeyproof",
  {
    signal: globalThis.AbortSignal.timeout(10000),
  },
);
if (packageResponse.status !== 200)
  throw new Error("Package bootstrap is required before OIDC staging");
if (response.status !== 404 && response.status !== 200)
  throw new Error("Registry version lookup failed");
// npm enforces a shared unique version index for staged and published versions.
const artifact = await readFile("release-artifact/journeyproof-0.1.0-rc.1.tgz");
const manifest = JSON.parse(
  await readFile("release-artifact/manifest.json", "utf8"),
);
const result = authorizeStaging({
  event: env.GITHUB_EVENT_NAME,
  repository: env.GITHUB_REPOSITORY,
  ref: env.GITHUB_REF,
  sha: env.GITHUB_SHA,
  approvedSha: env.APPROVED_SHA,
  mainSha: branch.commit.sha,
  version: env.APPROVED_VERSION,
  runner: env.RUNNER_ENVIRONMENT,
  environment: "npm-release",
  registry: "https://registry.npmjs.org/",
  digest: env.ARTIFACT_SHA512,
  expectedDigest: env.ARTIFACT_SHA512,
  artifact,
  license: await readFile("LICENSE"),
  notice: await readFile("NOTICE"),
  manifest,
  environmentConfig,
  branchPolicies,
  approvals,
  publishedVersionExists: response.status === 200,
  stagedVersionExists: "unknown",
});
console.log(
  JSON.stringify({
    ...result,
    commit: env.GITHUB_SHA,
    version: env.APPROVED_VERSION,
  }),
);
