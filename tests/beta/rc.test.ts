import { it, expect } from "vitest";
import {
  readFile,
  writeFile,
  readdir,
  rm,
  symlink,
  mkdir,
  rename,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { planBetaKit } from "../../src/distribution/beta.js";
import {
  planReleaseCandidate,
  stageReleaseCandidate,
  verifyReleaseCandidate,
  validateReleaseCandidate,
} from "../../src/distribution/rc.js";
import { sha256, inspectArchive } from "../../src/distribution/archive.js";
import {
  auditPackageScripts,
  auditReleasePolicy,
} from "../../src/distribution/policy.js";
import {
  payload,
  tarball,
  gate,
  rehearsal,
  digest,
  build,
} from "./fixtures.js";
import { temp } from "../helpers.js";
function input(version = "0.1.0-rc.1", missing?: string) {
  const entries = payload();
  const metadata = JSON.parse(entries.get("package.json")!.toString());
  metadata.version = version;
  entries.set("package.json", Buffer.from(JSON.stringify(metadata)));
  for (const name of [
    "docs/INSTALLATION.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "docs/FAQ.md",
    "dist/config/schema.d.ts",
  ])
    entries.set(name, Buffer.from("Synthetic safe asset\n"));
  if (missing) entries.delete(missing);
  const archive = tarball(entries);
  const beta = planBetaKit({
    archive,
    gate,
    rehearsal,
    sourceDigest: digest,
    buildDigest: build,
    node: process.version,
    platform: process.platform,
    commit: "c".repeat(40),
  });
  const files = new Map(
    Object.entries({
      ...beta.documents,
      [beta.archive]: archive,
      "SHA256SUMS.txt": `${sha256(archive)}  ${beta.archive}\n`,
      "beta-manifest.json": JSON.stringify(beta.manifest),
    }).map(([name, bytes]) => [name, Buffer.from(bytes)]),
  );
  return {
    betaFiles: files,
    sourceDigest: digest,
    buildDigest: build,
    repeatability: {
      firstBuild: build,
      secondBuild: build,
      firstArchive: sha256(archive),
      secondArchive: sha256(archive),
    },
    createdAt: "2026-11-05T00:00:00.000Z",
    npm: "11.19.1",
  };
}
it("plans deterministic RC metadata from exact verified package bytes and repeated build evidence", async () => {
  const i = input(),
    a = planReleaseCandidate(i),
    b = planReleaseCandidate(i);
  expect(a.manifest).toEqual(b.manifest);
  expect(validateReleaseCandidate(a.files)).toEqual(a.manifest);
  expect(a.manifest).toMatchObject({
    version: "0.1.0-rc.1",
    publicLaunch: "NO-GO",
    publicationAuthorized: false,
    externalTesters: 0,
    toolchain: { npm: "11.19.1", typescript: "6.0.3" },
  });
  const archive = a.files.get(a.manifest.archive)!;
  expect(a.manifest.sha256).toBe(sha256(archive));
  expect(a.manifest.bytes).toBe(archive.length);
  expect(a.manifest.packageFiles).toContainEqual({
    path: "dist/config/schema.d.ts",
    bytes: 21,
    sha256: sha256("Synthetic safe asset\n"),
  });
});
it("refuses stale builds, mismatched repetition, non-RC versions, missing docs and malformed provenance", () => {
  const good = input();
  for (const override of [
    { sourceDigest: "f".repeat(64) },
    { buildDigest: "f".repeat(64) },
    { createdAt: "yesterday" },
    { npm: "private-token" },
    { repeatability: {} },
    ...Object.keys(good.repeatability).map((key) => ({
      repeatability: { ...good.repeatability, [key]: "f".repeat(64) },
    })),
  ])
    expect(() => planReleaseCandidate({ ...good, ...override })).toThrow();
  expect(() => planReleaseCandidate(input("0.1.0"))).toThrow();
  expect(() =>
    planReleaseCandidate(input("0.1.0-rc.1", "docs/FAQ.md")),
  ).toThrow("documentation");
  for (const bytes of [undefined, Buffer.from("{invalid")]) {
    const i = input();
    if (bytes) i.betaFiles.set("beta-manifest.json", bytes);
    else i.betaFiles.delete("beta-manifest.json");
    expect(() => planReleaseCandidate(i)).toThrow("beta evidence");
  }
});
it("refuses forged RC fields, extra/missing files and unsafe write plans", async () => {
  const plan = planReleaseCandidate(input());
  for (const change of [
    { sha256: "f".repeat(64) },
    { bytes: 1 },
    { publicLaunch: "GO" },
    { packageFiles: [] },
    { testedOn: { platform: "win32", node: "v24.22.0" } },
    { toolchain: { ...plan.manifest.toolchain, playwright: "0.0.0" } },
  ]) {
    const files = new Map(plan.files);
    files.set(
      "rc-manifest.json",
      Buffer.from(JSON.stringify({ ...plan.manifest, ...change })),
    );
    expect(() => validateReleaseCandidate(files)).toThrow();
  }
  const t = await temp();
  try {
    for (const file of ["../escape", "extra.txt"]) {
      const files = new Map(plan.files);
      files.set(file, Buffer.from("unsafe"));
      await expect(
        stageReleaseCandidate(t.dir, { ...plan, files }),
      ).rejects.toThrow();
    }
    const files = new Map(plan.files);
    files.set("rc-manifest.json", Buffer.from("bad"));
    expect(() => validateReleaseCandidate(files)).toThrow("manifest");
    files.delete("rc-manifest.json");
    expect(() => validateReleaseCandidate(files)).toThrow("missing");
    expect(await readdir(t.dir)).toEqual([]);
  } finally {
    await t.cleanup();
  }
});
it("stages immutable private RCs, verifies actual archive and rejects path, symlink, corrupt and oversized output", async () => {
  const t = await temp(),
    outside = await temp();
  try {
    const plan = planReleaseCandidate(input());
    await mkdir(join(t.dir, "artifacts"));
    await symlink(outside.dir, join(t.dir, "artifacts/rc"));
    await expect(stageReleaseCandidate(t.dir, plan)).rejects.toThrow();
    expect(await readdir(outside.dir)).toEqual([]);
    await rm(join(t.dir, "artifacts/rc"));
    const dir = await stageReleaseCandidate(t.dir, plan),
      path = relative(t.dir, dir).split("\\").join("/");
    expect((await verifyReleaseCandidate(t.dir, path)).manifest.sha256).toBe(
      plan.manifest.sha256,
    );
    await expect(stageReleaseCandidate(t.dir, plan)).rejects.toThrow(
      "already exists",
    );
    await expect(verifyReleaseCandidate(t.dir, "../outside")).rejects.toThrow(
      "relative",
    );
    const moved = dir.slice(0, -20) + "f".repeat(20);
    await rename(dir, moved);
    await expect(
      verifyReleaseCandidate(
        t.dir,
        relative(t.dir, moved).split("\\").join("/"),
      ),
    ).rejects.toThrow("provenance");
    await rename(moved, dir);
    await writeFile(join(dir, plan.manifest.archive), Buffer.from("corrupt"));
    await expect(verifyReleaseCandidate(t.dir, path)).rejects.toThrow(
      "integrity",
    );
    await writeFile(
      join(dir, plan.manifest.archive),
      Buffer.alloc(3 * 1024 * 1024 + 1),
    );
    await expect(verifyReleaseCandidate(t.dir, path)).rejects.toThrow("size");
  } finally {
    await t.cleanup();
    await outside.cleanup();
  }
});
it.each([
  "npm --registry=https://registry.npmjs.org publish",
  "pnpm publish",
  "npm 'publish'",
  "git --no-pager push origin main",
  "gh repo edit --visibility public",
  "mcp-publisher@1.0.0 publish",
])("rejects actual metadata/workflow publication intent: %s", (command) => {
  const workflow =
    "on: [push]\npermissions:\n  contents: read\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run ci\n";
  expect(() => auditPackageScripts({ build: command })).toThrow("publishing");
  expect(() =>
    auditReleasePolicy({ private: true, license: "Apache-2.0" }, [
      workflow.replace("npm run ci", command),
    ]),
  ).toThrow("publication");
  const files = payload();
  const m = JSON.parse(files.get("package.json")!.toString());
  m.scripts = { build: command };
  files.set("package.json", Buffer.from(JSON.stringify(m)));
  expect(() => inspectArchive(tarball(files))).toThrow("publishing");
});
it("rejects lifecycle hooks and malformed scripts in archives without executing them", () => {
  for (const scripts of [
    null,
    [],
    { build: 7 },
    { postinstall: "node unexpected.mjs" },
    { prepack: "node unexpected.mjs" },
  ]) {
    expect(() => auditPackageScripts(scripts)).toThrow();
    const files = payload();
    const m = JSON.parse(files.get("package.json")!.toString());
    m.scripts = scripts;
    files.set("package.json", Buffer.from(JSON.stringify(m)));
    expect(() => inspectArchive(tarball(files))).toThrow();
  }
  expect(() => auditPackageScripts(undefined)).not.toThrow();
  expect(() =>
    auditPackageScripts({ build: "tsup && node scripts/chmod.mjs" }),
  ).not.toThrow();
});
it("RC verification CLI returns nonzero for a tampered archive and does not execute it", async () => {
  const t = await temp();
  try {
    const plan = planReleaseCandidate(input()),
      directory = await stageReleaseCandidate(t.dir, plan);
    const command = (await readFile("scripts/rc-verify.mjs", "utf8")).replace(
      '"../dist/index.js"',
      JSON.stringify(pathToFileURL(resolve("src/distribution/rc.ts")).href),
    );
    const runner = join(t.dir, "verify.mjs");
    await writeFile(runner, command);
    const args = [
      "--import",
      pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
      runner,
      "--kit",
      relative(t.dir, directory).split("\\").join("/"),
    ];
    expect(
      JSON.parse(
        (await promisify(execFile)(process.execPath, args, { cwd: t.dir }))
          .stdout,
      ).status,
    ).toBe("passed");
    await writeFile(join(directory, plan.manifest.archive), "tampered");
    const failed = await promisify(execFile)(process.execPath, args, {
      cwd: t.dir,
    }).catch((e) => e);
    expect(failed.code).toBe(2);
    expect(failed.stderr).toContain("RC verification failed");
    expect(failed.stdout).toBe("");
  } finally {
    await t.cleanup();
  }
});

it("keeps the Apache-2.0 RC private with aligned version/lock/runtime and inactive publishing/registry drafts", async () => {
  const { parse } = await import("yaml");
  const pkg = JSON.parse(await readFile("package.json", "utf8")),
    lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const { VERSION } = await import("../../src/shared/version.js");
  expect(pkg.version).toBe(VERSION);
  expect(lock.version).toBe(VERSION);
  expect(lock.packages[""].version).toBe(VERSION);
  expect(pkg.private).toBe(true);
  expect(pkg.license).toBe("Apache-2.0");
  expect(lock.packages[""].license).toBe(pkg.license);
  expect(pkg.version).toBe("0.1.0-rc.1");
  expect(pkg.files).toEqual(expect.arrayContaining(["LICENSE", "NOTICE"]));
  expect(await readFile("LICENSE", "utf8")).toContain(
    "END OF TERMS AND CONDITIONS",
  );
  expect(await readFile("NOTICE", "utf8")).toContain(
    "Copyright 2026 UsamaTahreemKhalid",
  );
  expect(pkg.mcpName).toBeUndefined();
  expect(pkg.scripts["rc:prepare"]).toBe("node scripts/rc-prepare.mjs");
  const draft = JSON.parse(await readFile(".mcp/server.json.example", "utf8"));
  expect(draft.name).toBe("io.github.UsamaTahreemKhalid/journeyproof");
  expect(draft.version).toBe(VERSION);
  expect(draft.repository).toEqual({
    url: "https://github.com/UsamaTahreemKhalid/journeyproof",
    source: "github",
  });
  expect(draft.packages[0]).toMatchObject({
    identifier: pkg.name,
    version: VERSION,
    transport: { type: "stdio" },
    packageArguments: [{ type: "positional", value: "mcp" }],
  });
  expect(draft.packages[0].environmentVariables).toEqual([
    expect.objectContaining({
      name: "JOURNEYPROOF_WORKSPACE_ROOT",
      isRequired: false,
    }),
    expect.objectContaining({
      name: "JOURNEYPROOF_FLOW_ROOT",
      isRequired: false,
    }),
  ]);
  const template = parse(
    await readFile("tests/fixtures/release/npm-publish.yml.example", "utf8"),
  );
  expect(template.jobs.publisher.if).toBe("${{ false }}");
  expect(template.jobs.publisher.environment).toBe(
    "OWNER_UNSELECTED_PROTECTED_ENVIRONMENT",
  );
  expect(template.jobs.publisher.permissions).toEqual({
    contents: "read",
    "id-token": "write",
  });
  expect(JSON.stringify(template.jobs.publisher.steps)).not.toMatch(
    /npm publish|mcp-publisher.*publish|NODE_AUTH_TOKEN|git push/,
  );
  const workflows = await readdir(".github/workflows");
  expect(workflows).not.toContain("npm-publish.yml");
  for (const name of ["build", "ci", "test:package"])
    expect(pkg.scripts[name]).not.toMatch(/publish|git push/);
});
it("source preflight rejects unsafe build intent before executing any build script", async () => {
  const t = await temp();
  try {
    await mkdir(join(t.dir, ".github/workflows"), { recursive: true });
    await writeFile(
      join(t.dir, ".github/workflows/ci.yml"),
      "on: [push]\npermissions:\n  contents: read\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run ci\n",
    );
    await writeFile(
      join(t.dir, "package.json"),
      JSON.stringify({
        private: true,
        license: "Apache-2.0",
        scripts: { build: "npm --registry=https://registry.npmjs.org publish" },
      }),
    );
    const module = pathToFileURL(resolve("scripts/lib/preflight.mjs")).href;
    const code = `import {preflightPolicy} from ${JSON.stringify(module)}; await preflightPolicy();`;
    const failed = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", code],
      { cwd: t.dir },
    ).catch((e) => e);
    expect(failed.code).not.toBe(0);
    expect(failed.stderr).toContain("Live publishing command");
    expect(await readdir(t.dir)).toEqual([".github", "package.json"]);
  } finally {
    await t.cleanup();
  }
});

it("rc:prepare records an actual failed beta gate, removes only its lock and never stages a ready candidate", async () => {
  const t = await temp();
  try {
    await mkdir(join(t.dir, ".github/workflows"), { recursive: true });
    await writeFile(
      join(t.dir, ".github/workflows/ci.yml"),
      "on: [push]\npermissions:\n  contents: read\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run ci\n",
    );
    await writeFile(
      join(t.dir, "package.json"),
      JSON.stringify({
        private: true,
        license: "Apache-2.0",
        scripts: { "beta:prepare": 'node -e "process.exit(1)"' },
      }),
    );
    let command = await readFile("scripts/rc-prepare.mjs", "utf8");
    for (const module of ["process", "fingerprints", "preflight"])
      command = command.replace(
        JSON.stringify(`./lib/${module}.mjs`),
        JSON.stringify(
          pathToFileURL(resolve(`scripts/lib/${module}.mjs`)).href,
        ),
      );
    const runner = join(t.dir, "prepare.mjs");
    await writeFile(runner, command);
    await mkdir(join(t.dir, ".journeyproof/rc-prepare"), { recursive: true });
    await writeFile(
      join(t.dir, ".journeyproof/rc-prepare/manifest.json"),
      JSON.stringify({ status: "passed" }),
    );
    const failed = await promisify(execFile)(process.execPath, [runner], {
      cwd: t.dir,
      env: process.env,
    }).catch((e) => e);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain("RC preparation failed");
    expect(
      JSON.parse(
        await readFile(
          join(t.dir, ".journeyproof/rc-prepare/manifest.json"),
          "utf8",
        ),
      ).status,
    ).toBe("failed");
    expect(await readdir(t.dir)).not.toContain("artifacts");
    expect(
      await readdir(join(t.dir, ".journeyproof/rc-prepare")),
    ).not.toContain("lock");
    await mkdir(join(t.dir, ".journeyproof/rc-prepare/lock"));
    await writeFile(
      join(t.dir, ".journeyproof/rc-prepare/manifest.json"),
      JSON.stringify({ status: "running" }),
    );
    const busy = await promisify(execFile)(process.execPath, [runner], {
      cwd: t.dir,
      env: process.env,
    }).catch((e) => e);
    expect(busy.code).toBe(2);
    expect(busy.stderr).toContain("Another RC preparation");
    expect(
      JSON.parse(
        await readFile(
          join(t.dir, ".journeyproof/rc-prepare/manifest.json"),
          "utf8",
        ),
      ).status,
    ).toBe("running");
    expect(await readdir(join(t.dir, ".journeyproof/rc-prepare"))).toContain(
      "lock",
    );
  } finally {
    await t.cleanup();
  }
});
