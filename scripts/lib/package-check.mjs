import { performance } from "node:perf_hooks";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  cp,
  mkdir,
  stat,
  access,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { connectMcp } from "../mcp-client.mjs";
import { npm, node } from "./process.mjs";
import { skillFrontmatter } from "./skill-frontmatter.mjs";
import {
  auditManifest,
  auditText,
  inspectArchive,
  auditPackageScripts,
} from "../../dist/index.js";

export async function verifyPackage({
  keep = false,
  light = false,
  archive,
  temporaryPrefix = "journeyproof package ",
} = {}) {
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), temporaryPrefix));
  const report = {
    schemaVersion: 1,
    status: "failed",
    platform: process.platform,
    node: process.version,
    npm: process.env.npm_config_user_agent,
    project: dir,
    retained: keep,
    light,
    checks: [],
    phases: [],
  };
  try {
    let pack, metadata;
    if (archive) {
      const inspection = inspectArchive(await readFile(archive));
      metadata = inspection.metadata;
      const filename = "journeyproof-" + metadata.version + ".tgz";
      await cp(archive, join(dir, filename), {
        errorOnExist: true,
        force: false,
      });
      pack = {
        filename,
        files: inspection.files,
        size: (await stat(archive)).size,
        unpackedSize: inspection.audit.unpackedBytes,
        integrity: "sha256-" + inspection.sha256,
      };
      report.audit = inspection.audit;
      report.checks.push(
        "selected exact tarball manifest/content/checksum audit",
      );
    } else {
      const packed = await packAudited(dir);
      metadata = packed.metadata;
      pack = packed.pack;
      report.audit = packed.audit;
      report.checks.push("dry-pack manifest and text audit");
    }
    const inspected = inspectArchive(await readFile(join(dir, pack.filename)));
    report.tarball = {
      path: join(dir, pack.filename),
      bytes: pack.size,
      unpackedBytes: pack.unpackedSize,
      files: pack.files.length,
      integrity: pack.integrity,
      sha256: inspected.sha256,
    };
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "journeyproof-local-consumer",
        private: true,
        type: "module",
      }),
    );
    const runtimeInstallStart = performance.now();
    await npm(
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        report.tarball.path,
      ],
      { cwd: dir },
    );
    report.phases.push({
      command: "npm install runtime",
      elapsedMs: performance.now() - runtimeInstallStart,
      exitCode: 0,
    });
    const pkg = join(dir, "node_modules/journeyproof"),
      bin = join(pkg, "dist/cli.js");
    for (const file of pack.files)
      if (!file.path.endsWith(".png"))
        auditText(await readFile(join(pkg, file.path), "utf8"));
    report.checks.push("installed tarball payload textual leak audit");
    const call = async (args) => {
      const began = performance.now();
      const value = JSON.parse(
        (await node([bin, ...args], { cwd: dir })).stdout,
      );
      report.phases.push({
        command: args[0],
        elapsedMs: performance.now() - began,
        exitCode: 0,
      });
      return value;
    };
    assert.equal(
      (await node([bin, "--version"], { cwd: dir })).stdout.trim(),
      metadata.version,
    );
    assert.match(
      (await node([bin, "--help"], { cwd: dir })).stdout,
      /JourneyProof/,
    );
    assert((await readFile(bin, "utf8")).startsWith("#!/usr/bin/env node"));
    const shim = join(
      dir,
      "node_modules/.bin/journeyproof" +
        (process.platform === "win32" ? ".cmd" : ""),
    );
    await access(shim);
    if (process.platform !== "win32") {
      assert((await stat(bin)).mode & 0o111);
      assert.equal(
        (
          await promisify(execFile)(shim, ["--version"], {
            cwd: dir,
            timeout: 10000,
          })
        ).stdout.trim(),
        metadata.version,
      );
    }
    await node([bin, "init"], { cwd: dir });
    const initialized = await readFile(
      join(dir, ".journeyproof/example.yaml"),
      "utf8",
    );
    assert(initialized.includes("schemaVersion"));
    await assert.rejects(
      () => node([bin, "init"], { cwd: dir }),
      (e) => e.code === 2,
    );
    assert.equal(
      await readFile(join(dir, ".journeyproof/example.yaml"), "utf8"),
      initialized,
    );
    await cp(
      join(pkg, "examples/admissions-demo"),
      join(dir, "examples/admissions-demo"),
      { recursive: true },
    );
    const flow = "examples/admissions-demo/journeys/happy-path.yaml";
    const doctor = await call([
      "doctor",
      "--flow",
      flow,
      "--json",
      ...(light ? ["--no-browser"] : []),
    ]);
    assert.equal(doctor.ok, true);
    report.doctor = doctor;
    await assert.rejects(
      () =>
        node([bin, "run", "--flow", "missing.yaml", "--json"], { cwd: dir }),
      (error) =>
        error.code === 2 && JSON.parse(error.stdout).status === "error",
    );
    const preview = await call([
      "generate-test",
      "--flow",
      flow,
      "--dry-run",
      "--json",
    ]);
    assert.equal(preview.eligible, true);
    assert.equal(preview.written, false);
    assert.equal(preview.assertions, 7);
    const installed = await import(
      pathToFileURL(join(pkg, "dist/index.js")).href
    );
    await import(pathToFileURL(join(pkg, "dist/testing.js")).href);
    const schemas = JSON.parse(
      await readFile(join(pkg, "docs/MAP_SCHEMAS.json"), "utf8"),
    );
    assert.deepEqual(z.toJSONSchema(installed.mapSchema), schemas.map);
    assert.deepEqual(
      z.toJSONSchema(installed.observationsSchema),
      schemas.observations,
    );
    const skillRoot = join(pkg, "skills/journeyproof");
    const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
    const front = parse(skillFrontmatter(skill));
    assert.equal(front.name, "journeyproof");
    assert(
      front.name.length <= 64 &&
        front.description.length > 0 &&
        front.description.length <= 1024,
    );
    assert(skill.split("\n").length < 100);
    for (const ref of skill.matchAll(/\]\(([^)]+)\)/g)) {
      assert(!ref[1].includes(".."));
      await access(join(skillRoot, ref[1]));
    }
    report.checks.push(
      "runtime-only CLI, doctor, safe init, definition generation, exports and installed skill",
    );
    // Keep the previous legacy-map reader/package-schema assertions as well as real runs below.
    const legacyId = "1793730000000-abcd1234",
      legacyDir = join(dir, ".journeyproof/runs", legacyId);
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      join(legacyDir, "run.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: legacyId,
        name: "package-smoke-input",
        status: "error",
        startedAt: "2026-11-05T00:00:00.000Z",
        durationMs: 0,
        metadata: {
          toolVersion: metadata.version,
          nodeVersion: "v24",
          hostname: "local",
          flowFile: "smoke.yaml",
          checksum: "smoke",
        },
        reproduction: "test-only legacy artifact",
        steps: [],
        http: [],
        errors: [],
        warnings: [],
      }),
    );
    const map = await call(["map", "--run", legacyId, "--json"]);
    assert.equal(map.status, "ok");
    assert(
      (await readFile(join(dir, map.paths.html), "utf8")).includes(
        "connect-src 'none'",
      ),
    );
    const mcpStarted = performance.now();
    const mcp = await connectMcp(process.execPath, [bin, "mcp"], dir, {
      JOURNEY_DEMO_EMAIL: "officer@example.test",
      JOURNEY_DEMO_PASSWORD: "fictional-demo-password",
    });
    try {
      const result = await mcp.client.callTool({
        name: "journeyproof_validate_flow",
        arguments: { flowPath: flow },
      });
      assert.equal(result.isError, false);
      assert.equal(result.structuredContent.data.stepCount, 15);
      assert(mcp.tools.some((t) => t.name === "journeyproof_run_flow"));
      const generated = await mcp.client.callTool({
        name: "journeyproof_generate_test",
        arguments: { flowPath: flow },
      });
      assert.equal(generated.isError, false);
      assert.equal(
        generated.structuredContent.data.source.mode,
        "definition-only",
      );
      assert.equal(generated.structuredContent.data.preview, preview.preview);
      const saved = await mcp.client.callTool({
        name: "journeyproof_get_map",
        arguments: { mapId: map.mapId },
      });
      assert.equal(saved.isError, false);
      assert.equal(saved.structuredContent.data.mapId, map.mapId);
      const documented = JSON.parse(
        await readFile(join(pkg, "docs/MCP_SCHEMAS.json"), "utf8"),
      );
      for (const tool of mcp.tools) {
        const snapshot = documented.tools.find((t) => t.name === tool.name);
        assert.deepEqual(tool.inputSchema, snapshot.inputSchema);
        assert.deepEqual(tool.annotations, snapshot.annotations);
        assert.deepEqual(
          tool.outputSchema,
          ["journeyproof_build_map", "journeyproof_get_map"].includes(tool.name)
            ? documented.mapOutputSchema
            : tool.name === "journeyproof_generate_test"
              ? documented.generationOutputSchema
              : documented.outputSchema,
        );
      }
      if (!light) {
        const { createDemo } = await import(
          pathToFileURL(join(pkg, "examples/admissions-demo/app/server.mjs"))
            .href
        );
        const runs = [];
        for (const broken of [false, true]) {
          const app = createDemo({ failApproval: broken });
          app.listen(0, "127.0.0.1");
          await once(app, "listening");
          try {
            const origin = `http://127.0.0.1:${app.address().port}`;
            const response = await mcp.client.callTool({
              name: "journeyproof_run_flow",
              arguments: { flowPath: flow, baseUrl: origin },
            });
            assert.equal(response.isError, false);
            const body = response.structuredContent;
            assert.equal(body.status, broken ? "failed" : "passed");
            if (broken) {
              assert.equal(body.data.failure.stepId, "approve-admission");
              assert.match(
                body.data.failure.reason,
                /Expected HTTP 200; observed HTTP 500/,
              );
            }
            const read = await mcp.client.callTool({
              name: "journeyproof_get_report",
              arguments: { runId: body.data.runId },
            });
            assert.equal(read.isError, false);
            assert.equal(read.structuredContent.data.runId, body.data.runId);
            runs.push({
              runId: body.data.runId,
              status: body.status,
              counts: body.data.counts,
            });
          } finally {
            app.closeAllConnections();
            await new Promise((resolve) => app.close(resolve));
          }
        }
        report.mcpRuns = runs;
      }
      report.mcp = {
        tools: mcp.tools.map((t) => t.name),
        validatePassed: true,
        stdoutProtocolOnly: true,
      };
    } finally {
      await mcp.close();
    }
    report.phases.push({
      command: "stdio SDK calls",
      elapsedMs: performance.now() - mcpStarted,
      exitCode: 0,
    });
    report.checks.push(
      "installed stdio MCP official client, eight contracts, legacy map reader",
    );
    const dependency = join(dir, "node_modules/prettier"),
      withheld = join(dir, "node_modules/prettier-withheld");
    await rename(dependency, withheld);
    try {
      await assert.rejects(
        () => node([bin, "--help"], { cwd: dir }),
        (error) =>
          error.code !== 0 && /ERR_MODULE_NOT_FOUND/.test(error.stderr),
      );
    } finally {
      await rename(withheld, dependency);
    }
    report.checks.push(
      "missing runtime dependency fails instead of falling back to the source checkout",
    );
    if (!light) {
      // Explicit consumer dev dependencies; CLI/MCP above already passed without them.
      await npm(
        [
          "install",
          "--save-dev",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "@playwright/test@" + metadata.devDependencies["@playwright/test"],
          "typescript@" + metadata.devDependencies.typescript,
          "@types/node@" + metadata.devDependencies["@types/node"],
        ],
        { cwd: dir },
      );
      const demoStart = performance.now();
      const demo = JSON.parse(
        (
          await node([join(pkg, "examples/verify-demo.mjs")], {
            cwd: dir,
            timeout: 180000,
          })
        ).stdout,
      );
      report.demo = demo;
      report.phases.push({
        command: "installed verify-demo",
        elapsedMs: performance.now() - demoStart,
        exitCode: 0,
      });
      await node(
        [
          join(dir, "node_modules/typescript/bin/tsc"),
          "--noEmit",
          "--strict",
          "--skipLibCheck",
          "--target",
          "ES2023",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          join(demo.workspace, demo.spec),
        ],
        { cwd: dir },
      );
      assert.equal(demo.healthy.status, "passed");
      assert.equal(demo.broken.status, "failed");
      assert.equal(demo.broken.failure, "Expected HTTP 200; observed HTTP 500");
      assert.equal(demo.viewer.loaded, true);
      report.checks.push(
        "installed healthy/same-spec HTTP500, generated compilation, real artifacts and offline viewer UI",
      );
    }
    report.status = "passed";
  } finally {
    report.harnessDurationMs = Date.now() - started;
    const output = resolve(".journeyproof/package-smoke");
    await mkdir(output, { recursive: true, mode: 0o700 });
    await writeFile(
      join(output, "manifest.json"),
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
    if (!keep) await rm(dir, { recursive: true, force: true });
  }
  return report;
}

export async function packAudited(dir) {
  const metadata = JSON.parse(await readFile("package.json", "utf8"));
  auditPackageScripts(metadata.scripts);
  assert.equal(metadata.private, true);
  assert.equal(metadata.license, "Apache-2.0");
  assert.equal(metadata.mcpName, undefined);
  const dry = JSON.parse(
    (await npm(["pack", "--dry-run", "--json"])).stdout,
  )[0];
  const audit = auditManifest(dry.files);
  const shipped = new Set(dry.files.map((file) => file.path));
  for (const file of dry.files) {
    if (!file.path.endsWith(".png")) {
      const content = await readFile(file.path, "utf8");
      auditText(content);
      if (file.path.endsWith(".md"))
        for (const link of content.matchAll(/\]\(([^)]+)\)/g)) {
          const target = link[1].split("#")[0];
          if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
          assert(
            shipped.has(
              posix.normalize(posix.join(posix.dirname(file.path), target)),
            ),
            "Packaged documentation link is missing its target: " +
              file.path +
              " -> " +
              target,
          );
        }
    }
  }

  const pack = JSON.parse(
    (await npm(["pack", "--json", "--pack-destination", dir])).stdout,
  )[0];
  assert.deepEqual(pack.files, dry.files);
  auditManifest(pack.files);
  const inspected = inspectArchive(await readFile(join(dir, pack.filename)));
  for (const name of ["LICENSE", "NOTICE"])
    assert.deepEqual(inspected.entries.get(name), await readFile(name));
  const tarball = {
    path: join(dir, pack.filename),
    bytes: pack.size,
    unpackedBytes: pack.unpackedSize,
    files: pack.files.length,
    integrity: pack.integrity,
  };
  return { metadata, pack, audit, tarball };
}
