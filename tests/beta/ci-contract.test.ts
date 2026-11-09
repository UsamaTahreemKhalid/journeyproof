import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { auditReleasePolicy } from "../../src/distribution/policy.js";
it("preserves every earlier CI gate, read-only matrix, complete test inclusion and original coverage thresholds", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  for (const command of [
    "format:check",
    "lint",
    "typecheck",
    "test:coverage",
    "build",
    "test:e2e",
    "demo:mcp",
    "demo:map",
    "demo:regression",
    "test:package",
  ])
    expect(pkg.scripts.ci).toContain("npm run " + command);
  expect(pkg.scripts.ci).toContain("npm pack --dry-run");
  expect(pkg.scripts["release:check"]).toBe("node scripts/release-check.mjs");
  expect(pkg.scripts["beta:prepare"]).toBe("node scripts/beta-prepare.mjs");
  const content = await readFile(".github/workflows/ci.yml", "utf8");
  expect(auditReleasePolicy(pkg, [content]).publicationAuthorized).toBe(false);
  const workflow = parse(content);
  expect(
    workflow.jobs.verify.steps.some(
      (s: { run?: string }) => s.run === "npm run ci",
    ),
  ).toBe(true);
  expect(workflow.jobs.portability.strategy.matrix.os).toEqual([
    "ubuntu-latest",
    "macos-latest",
    "windows-latest",
  ]);
  expect(content).not.toMatch(
    /continue-on-error|\|\|\s*true|pull_request_target|id-token:\s*write/,
  );
  const config = await readFile("vitest.config.ts", "utf8");
  for (const suite of [
    "unit",
    "integration",
    "mcp",
    "skill",
    "map",
    "regression",
    "beta",
  ])
    expect(config).toContain(`tests/${suite}/**/*.test.ts`);
  expect(config).toContain('include: ["tests/viewer/**/*.browser.test.ts"]');
  expect(config).toContain('include: ["src/**/*.ts"]');
  expect(config).toContain('exclude: ["src/cli/bin.ts", "src/index.ts"]');
  expect(config).toContain(
    "thresholds: { statements: 85, branches: 80, functions: 85, lines: 85 }",
  );
});
it("rejects masked failures, privilege escalation and publication in validation jobs", () => {
  const workflow =
    "on: [push, pull_request]\npermissions:\n  contents: read\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run ci\n";
  for (const bad of [
    workflow.replace("npm run ci", "npm run ci || true"),
    workflow + "# continue-on-error: true\n",
    workflow.replace("npm run ci", "npm publish"),
    workflow.replace("contents: read", "id-token: write"),
  ])
    expect(() =>
      auditReleasePolicy({ private: true, license: "Apache-2.0" }, [bad]),
    ).toThrow();
});

it("permits only the reviewed staging workflow and rejects its alteration", async () => {
  const content = await readFile(".github/workflows/npm-release.yml", "utf8");
  const workflow = parse(content);
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.jobs.prepare.if).toContain(
    "github.repository == 'UsamaTahreemKhalid/journeyproof'",
  );
  expect(workflow.jobs.prepare.if).toContain("github.ref == 'refs/heads/main'");
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.jobs.stage.permissions).toEqual({
    contents: "read",
    "id-token": "write",
    actions: "read",
  });
  expect(workflow.jobs.stage.environment).toBe("npm-release");
  expect(workflow.jobs.prepare.permissions).toBeUndefined();
  const guard = workflow.jobs.stage.steps.find(
    (step: { id?: string }) => step.id === "guard",
  );
  expect(guard.env.GITHUB_TOKEN).toBe("${{ github.token }}");
  const publishing = workflow.jobs.stage.steps.find(
    (step: { name?: string }) => step.name === "Stage reviewed tarball",
  );
  expect(publishing.env.GITHUB_TOKEN).toBeUndefined();
  expect(publishing.run).not.toContain("${{");
  expect(content).not.toMatch(/NODE_AUTH_TOKEN|npm publish|npm stage approve/);
  expect(
    auditReleasePolicy({ private: true, license: "Apache-2.0" }, [content])
      .publicationAuthorized,
  ).toBe(false);
  for (const altered of [
    content.replace("workflow_dispatch:", "push:"),
    content.replace("refs/heads/main", "refs/heads/other"),
    content.replace("id-token: write", "id-token: read"),
    content.replace("npm-release\n", "other\n"),
    content.replace("--tag next", "--tag latest"),
    content + "# modified\n",
  ])
    expect(() =>
      auditReleasePolicy({ private: true, license: "Apache-2.0" }, [altered]),
    ).toThrow();
});
