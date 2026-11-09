import { readFile, access, appendFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { authorizeStaging } from "../src/distribution/staging.ts";
import { fetchReleaseEvidence } from "../src/distribution/github-release.ts";
import {
  assertReleaseVersion,
  releaseFilename,
} from "../src/distribution/version.ts";
import { VERSION } from "../src/shared/version.ts";
const env = process.env;
if (env.GITHUB_RUN_ATTEMPT !== "1")
  throw new Error("Rerun attempts require a fresh dispatch and approval");
if (
  Object.entries(env).some(
    ([name, value]) =>
      value &&
      /^(?:NODE_AUTH_TOKEN|NPM_TOKEN|npm_config_.*(?:auth|token|password))$/i.test(
        name,
      ),
  )
)
  throw new Error("npm tokens are not allowed in the staging job");
const globalConfig =
  env.RUNNER_TEMP && join(env.RUNNER_TEMP, "journeyproof-empty-global.npmrc");
if (
  !globalConfig ||
  Object.entries(env).some(([name, value]) => {
    const key = name.toLowerCase();
    return (
      (key === "npm_config_userconfig" && value !== "/dev/null") ||
      (key === "npm_config_globalconfig" && value !== globalConfig)
    );
  }) ||
  env.NPM_CONFIG_USERCONFIG !== "/dev/null" ||
  env.NPM_CONFIG_GLOBALCONFIG !== globalConfig
)
  throw new Error("Unexpected npm configuration path in the staging job");
if (
  !(await lstat(globalConfig)).isFile() ||
  (await readFile(globalConfig)).length !== 0
)
  throw new Error("Global npm configuration must be an empty regular file");
try {
  await access(".npmrc");
  throw new Error("Project npm configuration is not allowed for staging");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const source = JSON.parse(await readFile("package.json", "utf8"));
assertReleaseVersion(source.version);
if (
  source.private !== true ||
  source.name !== "journeyproof" ||
  source.mcpName !== undefined ||
  source.version !== VERSION ||
  env.APPROVED_VERSION !== source.version
)
  throw new Error("Reviewed source version or package policy mismatch");
const filename = releaseFilename(source.version);
const evidence = await fetchReleaseEvidence(
  env.GITHUB_TOKEN,
  env.GITHUB_RUN_ID,
  source.version,
);
const artifact = await readFile(`release-artifact/${filename}`);
const manifest = JSON.parse(
  await readFile("release-artifact/manifest.json", "utf8"),
);
const result = authorizeStaging({
  event: env.GITHUB_EVENT_NAME,
  repository: env.GITHUB_REPOSITORY,
  ref: env.GITHUB_REF,
  sha: env.GITHUB_SHA,
  approvedSha: env.APPROVED_SHA,
  version: env.APPROVED_VERSION,
  sourceVersion: source.version,
  cliVersion: VERSION,
  filename,
  runner: env.RUNNER_ENVIRONMENT,
  environment: "npm-release",
  registry: "https://registry.npmjs.org/",
  digest: env.ARTIFACT_SHA512,
  expectedDigest: env.ARTIFACT_SHA512,
  artifact,
  license: await readFile("LICENSE"),
  notice: await readFile("NOTICE"),
  manifest,
  ...evidence,
  stagedVersionCheck: "registry-enforced",
});
if (!env.GITHUB_OUTPUT) throw new Error("GitHub output is required");
await appendFile(env.GITHUB_OUTPUT, `filename=${filename}\n`);
console.log(
  JSON.stringify({
    ...result,
    commit: env.GITHUB_SHA,
    version: source.version,
    stagedVersionCheck: "npm-registry-enforced",
  }),
);
