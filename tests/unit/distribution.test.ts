import { it, expect } from "vitest";
import {
  auditManifest,
  auditText,
  requiredAssets,
} from "../../src/distribution/audit.js";
import { auditReleasePolicy } from "../../src/distribution/policy.js";
const files = () => requiredAssets.map((path) => ({ path, size: 100 }));
it("audits real package boundaries and required runtime/demo/Skill assets", () => {
  expect(auditManifest(files())).toMatchObject({
    files: requiredAssets.length,
  });
  for (const path of [
    "src/secret.ts",
    "tests/fake.test.ts",
    ".env",
    "docs/WEEK99_REPORT.md",
    "docs/../../secret",
    "dist/.cache",
    "examples/session.json",
    "node_modules/pkg/package.json",
    ".git/config",
    "docs/assets/private.svg",
    "docs/assets/unreviewed.png",
  ])
    expect(() => auditManifest([...files(), { path, size: 10 }])).toThrow(
      "Unexpected",
    );
  expect(() => auditManifest(files().slice(1))).toThrow("asset missing");
  expect(() => auditManifest([...files(), files()[0]!])).toThrow("duplicate");
  for (const size of [-1, NaN, Infinity, 2 * 1024 * 1024 + 1])
    expect(() =>
      auditManifest(
        files().map((file) =>
          file.path === "docs/REPORTS.md" ? { ...file, size } : file,
        ),
      ),
    ).toThrow();
  expect(() => auditManifest([])).toThrow("empty");
  expect(() =>
    auditManifest(
      Array.from({ length: 201 }, (_, i) => ({
        path: `dist/x${i}.js`,
        size: 1,
      })),
    ),
  ).toThrow("large");
  expect(() =>
    auditManifest([
      ...files(),
      ...Array.from({ length: 4 }, (_, i) => ({
        path: `dist/x${i}.js`,
        size: 2 * 1024 * 1024,
      })),
    ]),
  ).toThrow("5 MiB");
});
it("rejects credential markers and Unix/Windows personal paths without echoing secret contents", () => {
  for (const value of [
    "-----BEGIN PRIVATE KEY-----",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "npm_" + "a".repeat(40),
    "ghp_" + "b".repeat(40),
    "/home/private-user/project",
    "/Users/private-user/code",
    "C:\\Users\\private-user\\code",
  ]) {
    try {
      auditText(value);
      throw Error("not rejected");
    } catch (error) {
      expect((error as Error).message).toContain("Private credential");
      expect((error as Error).message).not.toContain(value);
    }
  }
  expect(() =>
    auditText(
      "Required env name DEMO_PASSWORD; /absolute/checkout placeholder",
    ),
  ).not.toThrow();
});
const workflow =
  "on: [push, pull_request]\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run ci\n";
const metadata = {
  private: true,
  license: "Apache-2.0",
  scripts: { ci: "node scripts/verify.mjs" },
};
it("keeps validation separate from owner approval and blocks accidental publication/privileged CI", () => {
  expect(auditReleasePolicy(metadata, [workflow])).toEqual({
    validationWorkflows: 1,
    publicationAuthorized: false,
    private: true,
  });
  for (const input of [
    { ...metadata, private: false },
    { ...metadata, private: undefined },
    { ...metadata, mcpName: "io.github.UsamaTahreemKhalid/journeyproof" },
    { ...metadata, license: "UNLICENSED" },
    { ...metadata, license: "MIT" },
  ])
    expect(() => auditReleasePolicy(input, [workflow])).toThrow("Owner");
  for (const command of [
    "npm publish",
    "pnpm publish",
    "gh repo edit --visibility public",
    "npm stage publish",
    "git push origin main",
    "gh release create v1",
    "mcp-publisher publish",
  ]) {
    expect(() =>
      auditReleasePolicy({ ...metadata, scripts: { release: command } }, [
        workflow,
      ]),
    ).toThrow("publishing command");
    expect(() =>
      auditReleasePolicy(metadata, [workflow.replace("npm run ci", command)]),
    ).toThrow("publication");
  }
  for (const content of [
    workflow.replace("pull_request", "pull_request_target"),
    workflow.replace("contents: read", "contents: write"),
    workflow.replace("contents: read", "id-token: write"),
    workflow.replace(
      "    runs-on:",
      "    permissions:\n      id-token: write\n    runs-on:",
    ),
    workflow.replace("npm run ci", "uses: actions/upload-artifact@v4"),
    "a: [",
    "on: x\non: y",
    "null",
  ])
    expect(() => auditReleasePolicy(metadata, [content])).toThrow();
  expect(() => auditReleasePolicy(metadata, [])).toThrow("missing");
  expect(
    auditReleasePolicy(metadata, [
      workflow.replace(
        "    runs-on:",
        "    permissions:\n      contents: read\n    runs-on:",
      ),
    ]).publicationAuthorized,
  ).toBe(false);
});
