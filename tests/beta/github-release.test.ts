import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { fetchReleaseEvidence } from "../../src/distribution/github-release.js";
import {
  assertReleaseVersion,
  releaseFilename,
  assertNpmStagingVersion,
} from "../../src/distribution/version.js";
const sha = "a".repeat(40);
const body = (url: string) => {
  if (url.includes("/approvals"))
    return [
      {
        state: "approved",
        user: { login: "UsamaTahreemKhalid" },
        environments: [{ name: "npm-release" }],
      },
    ];
  if (url.includes("deployment-branch-policies"))
    return {
      total_count: 1,
      branch_policies: [{ name: "main", type: "branch" }],
    };
  if (url.endsWith("/environments/npm-release"))
    return {
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
        protected_branches: false,
        custom_branch_policies: true,
      },
    };
  if (url.endsWith("/branches/main"))
    return { protected: true, commit: { sha } };
  return {};
};
const mockFetch = (
  options: {
    fail?: string;
    malformed?: string;
    paginated?: string;
    exists?: boolean;
  } = {},
) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if (address.startsWith("https://api.github.com/")) {
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer test-token",
      );
      if (options.fail && address.includes(options.fail))
        return new Response("unavailable", { status: 403 });
      const payload =
        options.malformed && address.includes(options.malformed)
          ? {}
          : body(address);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers:
          options.paginated && address.includes(options.paginated)
            ? { link: '<https://api.github.com/next>; rel="next"' }
            : {},
      });
    }
    expect(init?.headers).toBeUndefined();
    return new Response("{}", {
      status: address.endsWith("/journeyproof") || options.exists ? 200 : 404,
    });
  }) as unknown as typeof fetch;
describe("release versions and authenticated evidence", () => {
  it("requires a supported, well-formed npm staging CLI version", () => {
    for (const version of ["11.15.0", "11.19.1", "12.0.0"])
      expect(() => assertNpmStagingVersion(version)).not.toThrow();
    for (const version of [
      "11.14.9",
      "10.99.0",
      "11.15",
      "v11.15.0",
      "11.15.0-rc.1",
      "NaN",
      "999999999999999999.0.0",
    ])
      expect(() => assertNpmStagingVersion(version)).toThrow();
  });
  it("blocks reruns and npm tokens before any network operation", () => {
    for (const env of [
      { GITHUB_RUN_ATTEMPT: "2" },
      { GITHUB_RUN_ATTEMPT: "1", NODE_AUTH_TOKEN: "synthetic-secret" },
      { GITHUB_RUN_ATTEMPT: "1", NPM_CONFIG__AUTH: "synthetic-secret" },
      {
        GITHUB_RUN_ATTEMPT: "1",
        npm_config_userconfig: "/tmp/untrusted-npmrc",
      },
    ]) {
      try {
        execFileSync(
          process.execPath,
          ["--import", "tsx", "scripts/staging-preflight.mjs"],
          { env: { ...process.env, ...env }, encoding: "utf8", stdio: "pipe" },
        );
        throw new Error("Expected failure");
      } catch (error) {
        const failure = error as { status?: number; stderr?: string };
        expect(failure.status).not.toBe(0);
        expect(failure.stderr).not.toContain("synthetic-secret");
        expect(failure.stderr).toMatch(
          /Rerun attempts|npm tokens are not allowed|Unexpected npm configuration/,
        );
      }
    }
  });
  it("accepts exact future prereleases and stable versions and rejects unsafe versions", () => {
    for (const version of ["0.1.0-rc.2", "0.1.0-rc.8", "1.0.0"])
      expect(releaseFilename(version)).toBe(`journeyproof-${version}.tgz`);
    for (const version of [
      "v1.0.0",
      "01.0.0",
      "1.0.0-01",
      "1.0.0+build",
      "../1.0.0",
      "1.0",
      "1.0.0-",
      "999999999999999999.0.0",
      "",
    ])
      expect(() => assertReleaseVersion(version)).toThrow();
  });
  it("queries GitHub with its token and never sends it to npm", async () => {
    const evidence = await fetchReleaseEvidence(
      "test-token",
      "123",
      "0.1.0-rc.2",
      mockFetch(),
    );
    expect(evidence.mainSha).toBe(sha);
    expect(evidence.publishedVersionExists).toBe(false);
    expect(
      (
        await fetchReleaseEvidence(
          "test-token",
          "123",
          "0.1.0-rc.2",
          mockFetch({ exists: true }),
        )
      ).publishedVersionExists,
    ).toBe(true);
  });
  it("fails closed for missing credentials, malformed responses, pagination and API failure", async () => {
    await expect(
      fetchReleaseEvidence("", "123", "0.1.0", mockFetch()),
    ).rejects.toThrow();
    await expect(
      fetchReleaseEvidence("test-token", "../bad", "0.1.0", mockFetch()),
    ).rejects.toThrow();
    for (const option of [
      { fail: "approvals" },
      { malformed: "approvals" },
      { malformed: "branches/main" },
      { malformed: "deployment-branch-policies" },
      { paginated: "approvals" },
    ])
      await expect(
        fetchReleaseEvidence("test-token", "123", "0.1.0", mockFetch(option)),
      ).rejects.toThrow();
    await expect(
      fetchReleaseEvidence(
        "test-token",
        "123",
        "0.1.0",
        vi.fn().mockRejectedValue(new Error("network")) as typeof fetch,
      ),
    ).rejects.toThrow();
  });
});
