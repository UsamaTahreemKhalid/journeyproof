import { createHash } from "node:crypto";
import { InputError } from "../shared/errors.js";
import { inspectArchive } from "./archive.js";
import { assertReleaseVersion, releaseFilename } from "./version.js";

const owner = "UsamaTahreemKhalid";
const identity = "io.github.UsamaTahreemKhalid/journeyproof";
export function authorizeStaging(input: {
  event: string;
  repository: string;
  ref: string;
  sha: string;
  approvedSha: string;
  mainSha: string;
  version: string;
  sourceVersion: string;
  cliVersion: string;
  filename: string;
  runner: string;
  environment: string;
  registry: string;
  digest: string;
  expectedDigest: string;
  artifact: Uint8Array;
  license: Uint8Array;
  notice: Uint8Array;
  manifest: {
    name: string;
    version: string;
    filename: string;
    mcpName: string;
    sha512: string;
    integrity: string;
    files: unknown;
  };
  environmentConfig: {
    name?: string;
    protection_rules?: {
      type?: string;
      reviewers?: { type?: string; reviewer?: { login?: string } }[];
    }[];
    deployment_branch_policy?: {
      protected_branches?: boolean;
      custom_branch_policies?: boolean;
    };
  };
  branchPolicies: {
    total_count: number;
    branch_policies: { name: string; type: string }[];
  };
  approvals: {
    state?: string;
    user?: { login?: string };
    environments?: { name?: string }[];
  }[];
  publishedVersionExists: boolean;
  stagedVersionCheck: "registry-enforced";
}) {
  const fail = () => {
    throw new InputError("Staging authorization denied");
  };
  assertReleaseVersion(input.sourceVersion);
  if (
    input.event !== "workflow_dispatch" ||
    input.repository !== `${owner}/journeyproof` ||
    input.ref !== "refs/heads/main" ||
    !/^[a-f0-9]{40}$/.test(input.sha) ||
    input.sha !== input.approvedSha ||
    input.sha !== input.mainSha ||
    input.version !== input.sourceVersion ||
    input.cliVersion !== input.sourceVersion ||
    input.filename !== releaseFilename(input.sourceVersion) ||
    input.runner !== "github-hosted" ||
    input.environment !== "npm-release" ||
    input.registry !== "https://registry.npmjs.org/" ||
    input.publishedVersionExists ||
    input.stagedVersionCheck !== "registry-enforced"
  )
    fail();
  const config = input.environmentConfig;
  const policy = config.deployment_branch_policy;
  const protectedBranches =
    policy?.protected_branches === true &&
    policy.custom_branch_policies === false;
  const mainOnly =
    policy?.protected_branches === false &&
    policy.custom_branch_policies === true &&
    input.branchPolicies.total_count === 1 &&
    input.branchPolicies.branch_policies.length === 1 &&
    input.branchPolicies.branch_policies[0]?.name === "main" &&
    input.branchPolicies.branch_policies[0]?.type === "branch";
  if (
    config.name !== "npm-release" ||
    (!protectedBranches && !mainOnly) ||
    !config.protection_rules?.some(
      (r) =>
        r.type === "required_reviewers" &&
        r.reviewers?.some(
          (v) => v.type === "User" && v.reviewer?.login === owner,
        ),
    )
  )
    fail();
  const releaseApprovals = input.approvals.filter((approval) =>
    approval.environments?.some(
      (environment) => environment.name === "npm-release",
    ),
  );
  if (
    !releaseApprovals.length ||
    releaseApprovals.some(
      (approval) =>
        approval.state !== "approved" || approval.user?.login !== owner,
    )
  )
    fail();
  const digest = createHash("sha512").update(input.artifact).digest("hex");
  if (
    !/^[a-f0-9]{128}$/.test(input.expectedDigest) ||
    digest !== input.expectedDigest ||
    digest !== input.digest ||
    digest !== input.manifest.sha512 ||
    input.manifest.integrity !==
      `sha512-${Buffer.from(digest, "hex").toString("base64")}`
  )
    fail();
  const archive = inspectArchive(
    input.artifact,
    undefined,
    "public",
    input.sourceVersion,
  );
  if (
    !archive.entries.get("LICENSE")?.equals(Buffer.from(input.license)) ||
    !archive.entries.get("NOTICE")?.equals(Buffer.from(input.notice)) ||
    input.manifest.name !== "journeyproof" ||
    input.manifest.version !== input.version ||
    input.manifest.filename !== input.filename ||
    input.manifest.mcpName !== identity ||
    JSON.stringify(input.manifest.files) !== JSON.stringify(archive.files)
  )
    fail();
  return { authorized: true as const, digest };
}
