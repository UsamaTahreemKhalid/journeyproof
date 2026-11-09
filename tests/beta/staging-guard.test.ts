import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "yaml";
import { inspectArchive } from "../../src/distribution/archive.js";
import { VERSION } from "../../src/shared/version.js";
import { payload, tarball } from "./fixtures.js";
const exec = promisify(execFile);
it("emits a safe filename only after actual guard validation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jp-guard-"));
  try {
    const files = payload();
    const metadata = JSON.parse(files.get("package.json")!.toString());
    Object.assign(metadata, {
      version: VERSION,
      private: false,
      mcpName: "io.github.UsamaTahreemKhalid/journeyproof",
    });
    files.set("package.json", Buffer.from(JSON.stringify(metadata)));
    const archive = tarball(files);
    const digest = createHash("sha512").update(archive).digest("hex");
    const filename = `journeyproof-${VERSION}.tgz`;
    const manifest = {
      name: metadata.name,
      version: VERSION,
      filename,
      mcpName: metadata.mcpName,
      sha512: digest,
      integrity: `sha512-${Buffer.from(digest, "hex").toString("base64")}`,
      files: inspectArchive(archive, undefined, "public", VERSION).files,
    };
    await mkdir(join(dir, "release-artifact"));
    await writeFile(join(dir, "release-artifact", filename), archive);
    await writeFile(
      join(dir, "release-artifact/manifest.json"),
      JSON.stringify(manifest),
    );
    await writeFile(join(dir, "LICENSE"), files.get("LICENSE")!);
    await writeFile(join(dir, "NOTICE"), files.get("NOTICE")!);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "journeyproof", private: true, version: VERSION }),
    );
    const sha = "a".repeat(40);
    const mock = `globalThis.fetch = async (url) => { const u=String(url); let v={}; if(u.includes('/approvals')) v=[{state:process.env.MOCK_REJECT?'rejected':'approved',user:{login:'UsamaTahreemKhalid'},environments:[{name:'npm-release'}]}]; else if(u.includes('deployment-branch-policies')) v={total_count:1,branch_policies:[{name:'main',type:'branch'}]}; else if(u.endsWith('/environments/npm-release')) v={name:'npm-release',protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{login:'UsamaTahreemKhalid'}}]}],deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}}; else if(u.endsWith('/branches/main')) v={protected:true,commit:{sha:process.env.MOCK_MAIN_SHA}}; return new Response(JSON.stringify(v),{status:u.includes('registry.npmjs.org/journeyproof/')?404:200}); };`;
    const mockPath = join(dir, "mock.mjs");
    await writeFile(mockPath, mock);
    const output = join(dir, "output");
    const globalConfig = join(dir, "journeyproof-empty-global.npmrc");
    await writeFile(globalConfig, "");
    const env = {
      ...process.env,
      NODE_AUTH_TOKEN: "",
      NPM_TOKEN: "",
      npm_config_userconfig: "/dev/null",
      npm_config_globalconfig: globalConfig,
      NPM_CONFIG_USERCONFIG: "/dev/null",
      NPM_CONFIG_GLOBALCONFIG: globalConfig,
      RUNNER_TEMP: dir,
      GITHUB_TOKEN: "fake-read-token",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_RUN_ID: "123",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REPOSITORY: "UsamaTahreemKhalid/journeyproof",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: sha,
      MOCK_MAIN_SHA: sha,
      APPROVED_SHA: sha,
      APPROVED_VERSION: VERSION,
      RUNNER_ENVIRONMENT: "github-hosted",
      ARTIFACT_SHA512: digest,
      GITHUB_OUTPUT: output,
    };
    const run = (extra: Record<string, string | undefined> = {}) =>
      exec(
        process.execPath,
        [
          "--import",
          resolve("node_modules/tsx/dist/loader.mjs"),
          "--import",
          mockPath,
          resolve("scripts/staging-preflight.mjs"),
        ],
        { cwd: dir, env: { ...env, ...extra }, timeout: 10000 },
      );
    await run();
    expect(await readFile(output, "utf8")).toBe(`filename=${filename}\n`);
    for (const change of [
      { APPROVED_VERSION: "../evil" },
      { APPROVED_SHA: "b".repeat(40) },
      { ARTIFACT_SHA512: "0".repeat(128) },
      { MOCK_REJECT: "1" },
      { GITHUB_OUTPUT: "" },
      { NPM_CONFIG_GLOBALCONFIG: "/dev/null" },
    ]) {
      await rm(output, { force: true });
      await expect(run(change)).rejects.toThrow();
      await expect(readFile(output)).rejects.toThrow();
    }
    await writeFile(globalConfig, "registry=https://example.invalid/\n");
    await expect(run()).rejects.toThrow();
    await writeFile(globalConfig, "");
    await writeFile(
      join(dir, "release-artifact", filename),
      Buffer.from("tampered"),
    );
    await expect(run()).rejects.toThrow();
    await expect(readFile(output)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("isolates npm config with distinct files that npm can load", async () => {
  const workflow = parse(
    await readFile(".github/workflows/npm-release.yml", "utf8"),
  );
  const stage = workflow.jobs.stage;
  expect(stage.env.NPM_CONFIG_USERCONFIG).toBe("/dev/null");
  expect(stage.env.NPM_CONFIG_GLOBALCONFIG).toBe(
    "${{ runner.temp }}/journeyproof-empty-global.npmrc",
  );
  const setup = stage.steps.find(
    (step: { name?: string }) =>
      step.name === "Initialize isolated npm configuration",
  );
  expect(setup.run).toContain('test ! -e "$NPM_CONFIG_GLOBALCONFIG"');
  const dir = await mkdtemp(join(tmpdir(), "jp-npm-config-"));
  try {
    await writeFile(join(dir, ".npmrc"), "registry=https://example.invalid/\n");
    const globalConfig = join(dir, "journeyproof-empty-global.npmrc");
    await exec("bash", ["-e", "-c", setup.run], {
      env: { ...process.env, NPM_CONFIG_GLOBALCONFIG: globalConfig },
    });
    const { stdout } = await exec("npm", ["config", "get", "registry"], {
      cwd: dir,
      env: {
        ...process.env,
        HOME: join(dir, "home"),
        NPM_CONFIG_USERCONFIG: "/dev/null",
        NPM_CONFIG_GLOBALCONFIG: globalConfig,
      },
    });
    // Project config is intentionally prohibited by the guard; verify the two
    // isolated files load by running outside that project config.
    expect(stdout.trim()).toBe("https://example.invalid/");
    await rm(join(dir, ".npmrc"));
    const clean = await exec("npm", ["config", "get", "registry"], {
      cwd: dir,
      env: {
        ...process.env,
        NPM_CONFIG_USERCONFIG: "/dev/null",
        NPM_CONFIG_GLOBALCONFIG: globalConfig,
      },
    });
    expect(clean.stdout.trim()).toBe("https://registry.npmjs.org/");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("release command preconditions reject empty or mismatched guard outputs without invoking npm", async () => {
  const workflow = parse(
    await readFile(".github/workflows/npm-release.yml", "utf8"),
  );
  const stage = workflow.jobs.stage.steps.find(
    (step: { name?: string }) => step.name === "Stage reviewed tarball",
  );
  expect(stage.env.ARTIFACT_FILENAME).toBe(
    "${{ steps.guard.outputs.filename }}",
  );
  expect(stage.env.PREPARED_FILENAME).toBe(
    "${{ needs.prepare.outputs.filename }}",
  );
  expect(stage.shell).toBe("bash");
  const checks = stage.run.split("\n").slice(0, 3).join("\n");
  const dir = await mkdtemp(join(tmpdir(), "jp-guard-output-"));
  try {
    await mkdir(join(dir, "release-artifact"));
    const filename = `journeyproof-${VERSION}.tgz`;
    await writeFile(join(dir, "release-artifact", filename), "fixture");
    const run = (artifact: string, prepared: string) =>
      exec("bash", ["-e", "-c", checks], {
        cwd: dir,
        env: {
          ...process.env,
          ARTIFACT_FILENAME: artifact,
          PREPARED_FILENAME: prepared,
        },
      });
    await expect(run(filename, filename)).resolves.toBeDefined();
    for (const value of [
      "",
      "../evil.tgz",
      "journeyproof-$(touch pwned).tgz",
      "journeyproof-1.0.0.tgz\nother",
      "journeyproof-missing.tgz",
    ])
      await expect(run(value, value)).rejects.toThrow();
    await expect(run(filename, "other.tgz")).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
