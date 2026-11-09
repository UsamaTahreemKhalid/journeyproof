import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { inspectArchive } from "../../src/distribution/archive.js";
import { authorizeStaging } from "../../src/distribution/staging.js";
import { payload, tarball } from "./fixtures.js";

function candidate(version = "0.1.0-rc.2") {
  const files = payload();
  const meta = JSON.parse(files.get("package.json")!.toString());
  Object.assign(meta, {
    name: "journeyproof",
    version,
    private: false,
    mcpName: "io.github.UsamaTahreemKhalid/journeyproof",
  });
  files.set("package.json", Buffer.from(JSON.stringify(meta)));
  const artifact = tarball(files);
  const digest = createHash("sha512").update(artifact).digest("hex");
  const manifest = {
    name: meta.name,
    version: meta.version,
    filename: `journeyproof-${meta.version}.tgz`,
    mcpName: meta.mcpName,
    sha512: digest,
    integrity: `sha512-${Buffer.from(digest, "hex").toString("base64")}`,
    files: inspectArchive(artifact, undefined, "public", version).files,
  };
  const sha = "a".repeat(40);
  return {
    event: "workflow_dispatch",
    repository: "UsamaTahreemKhalid/journeyproof",
    ref: "refs/heads/main",
    sha,
    approvedSha: sha,
    mainSha: sha,
    version: meta.version,
    sourceVersion: meta.version,
    cliVersion: meta.version,
    filename: `journeyproof-${meta.version}.tgz`,
    runner: "github-hosted",
    environment: "npm-release",
    registry: "https://registry.npmjs.org/",
    digest,
    expectedDigest: digest,
    artifact,
    license: files.get("LICENSE")!,
    notice: files.get("NOTICE")!,
    manifest,
    branchPolicies: { total_count: 0, branch_policies: [] },
    environmentConfig: {
      name: "npm-release",
      protection_rules: [
        {
          type: "required_reviewers",
          reviewers: [
            { type: "User", reviewer: { login: "UsamaTahreemKhalid" } },
          ],
        },
      ],
      deployment_branch_policy: {
        protected_branches: true,
        custom_branch_policies: false,
      },
    },
    approvals: [
      {
        state: "approved",
        user: { login: "UsamaTahreemKhalid" },
        environments: [{ name: "npm-release" }],
      },
    ],
    publishedVersionExists: false,
    stagedVersionCheck: "registry-enforced" as const,
  };
}
it("requires an explicitly approved protected context and the exact inspected public artifact", () => {
  const valid = candidate();
  expect(authorizeStaging(valid).authorized).toBe(true);
  for (const version of ["0.1.0-rc.3", "1.0.0"])
    expect(authorizeStaging(candidate(version)).authorized).toBe(true);
  expect(
    authorizeStaging({
      ...valid,
      environmentConfig: {
        ...valid.environmentConfig,
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: true,
        },
      },
      branchPolicies: {
        total_count: 1,
        branch_policies: [{ name: "main", type: "branch" }],
      },
    }).authorized,
  ).toBe(true);
  for (const change of [
    { event: "push" },
    { event: "pull_request" },
    { repository: "fork/journeyproof" },
    { ref: "refs/heads/dev" },
    { sha: "bad" },
    { approvedSha: "b".repeat(40) },
    { mainSha: "b".repeat(40) },
    { version: "0.1.0" },
    { sourceVersion: "invalid" },
    { cliVersion: "0.2.0" },
    { filename: "../package.tgz" },
    { runner: "self-hosted" },
    { environment: "other" },
    { registry: "https://example.com/" },
    { publishedVersionExists: true },
    { stagedVersionCheck: "unknown" as "registry-enforced" },
    { approvals: [] },
    {
      approvals: [
        ...valid.approvals,
        {
          state: "rejected",
          user: { login: "UsamaTahreemKhalid" },
          environments: [{ name: "npm-release" }],
        },
      ],
    },
    {
      approvals: [
        {
          state: "approved",
          user: { login: "other" },
          environments: [{ name: "npm-release" }],
        },
      ],
    },
    {
      approvals: [
        {
          state: "approved",
          user: { login: "UsamaTahreemKhalid" },
          environments: [{ name: "other" }],
        },
      ],
    },
    {
      environmentConfig: {
        name: "npm-release",
        protection_rules: [],
        deployment_branch_policy: {
          protected_branches: true,
          custom_branch_policies: false,
        },
      },
    },
    {
      environmentConfig: {
        ...valid.environmentConfig,
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: true,
        },
      },
    },
    { digest: "0".repeat(128) },
    { expectedDigest: "not-a-digest" },
    { artifact: Buffer.from("changed") },
    { license: Buffer.from("changed") },
    { notice: Buffer.from("changed") },
    { manifest: { ...valid.manifest, name: "other" } },
    { manifest: { ...valid.manifest, version: "wrong" } },
    { manifest: { ...valid.manifest, filename: "../wrong.tgz" } },
    {
      manifest: { ...valid.manifest, mcpName: "io.github.other/journeyproof" },
    },
    { manifest: { ...valid.manifest, sha512: "0".repeat(128) } },
    { manifest: { ...valid.manifest, integrity: "sha512-incorrect" } },
    { manifest: { ...valid.manifest, files: [] } },
  ])
    expect(() => authorizeStaging({ ...valid, ...change })).toThrow();
});
