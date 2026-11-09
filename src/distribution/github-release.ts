import { z } from "zod";
import { assertReleaseVersion } from "./version.js";
const base = "https://api.github.com/repos/UsamaTahreemKhalid/journeyproof";
const reviewer = z.object({
  type: z.string(),
  reviewer: z.object({ login: z.string().optional() }),
});
const environment = z.object({
  name: z.string(),
  protection_rules: z.array(
    z.object({ type: z.string(), reviewers: z.array(reviewer).optional() }),
  ),
  deployment_branch_policy: z.object({
    protected_branches: z.boolean(),
    custom_branch_policies: z.boolean(),
  }),
});
const approvalsSchema = z.array(
  z.object({
    state: z.string(),
    user: z.object({ login: z.string() }),
    environments: z.array(z.object({ name: z.string() })),
  }),
);
const branchSchema = z.object({
  protected: z.literal(true),
  commit: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }),
});
const branchPolicySchema = z
  .object({
    total_count: z.number().int().nonnegative().max(100),
    branch_policies: z
      .array(z.object({ name: z.string(), type: z.string() }))
      .max(100),
  })
  .refine((v) => v.total_count === v.branch_policies.length);
export async function fetchReleaseEvidence(
  token: string,
  runId: string,
  version: string,
  fetcher: typeof fetch = fetch,
) {
  assertReleaseVersion(version);
  if (!token || !/^[1-9]\d*$/.test(runId))
    throw new Error("GitHub read authorization and run ID required");
  const github = async (url: string) => {
    const response = await fetcher(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "journeyproof-release-check",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || /rel="next"/.test(response.headers.get("link") ?? ""))
      throw new Error("GitHub release verification unavailable or incomplete");
    return response.json();
  };
  const [env, approvalData, branch, policies] = await Promise.all([
    github(`${base}/environments/npm-release`),
    github(`${base}/actions/runs/${runId}/approvals?per_page=100`),
    github(`${base}/branches/main`),
    github(
      `${base}/environments/npm-release/deployment-branch-policies?per_page=100`,
    ),
  ]);
  const check = await fetcher(
    `https://registry.npmjs.org/journeyproof/${encodeURIComponent(version)}`,
    { redirect: "error", signal: AbortSignal.timeout(10000) },
  );
  if (check.status !== 200 && check.status !== 404)
    throw new Error("npm version lookup unavailable");
  const pkg = await fetcher("https://registry.npmjs.org/journeyproof", {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (pkg.status !== 200)
    throw new Error("npm package unavailable or bootstrap required");
  return {
    environmentConfig: environment.parse(env),
    approvals: approvalsSchema.parse(approvalData),
    mainSha: branchSchema.parse(branch).commit.sha,
    branchPolicies: branchPolicySchema.parse(policies),
    publishedVersionExists: check.status === 200,
  };
}
