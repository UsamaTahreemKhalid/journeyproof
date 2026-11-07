import { it, expect } from "vitest";
import { cp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planBetaKit } from "../../src/distribution/beta.js";
import { sha256 } from "../../src/distribution/archive.js";
import {
  payload,
  tarball,
  gate,
  rehearsal,
  digest,
  build,
} from "./fixtures.js";
import { temp } from "../helpers.js";
it("beta:prepare exits nonzero on an actual failed gate subprocess, replaces stale success pointers and never stages a new kit", async () => {
  const t = await temp();
  try {
    await mkdir(join(t.dir, "scripts/lib"), { recursive: true });
    for (const file of [
      "beta-prepare.mjs",
      "lib/process.mjs",
      "lib/fingerprints.mjs",
    ])
      await cp("scripts/" + file, join(t.dir, "scripts", file));
    await writeFile(
      join(t.dir, "package.json"),
      JSON.stringify({
        type: "module",
        scripts: { "release:check": 'node -e "process.exit(1)"' },
      }),
    );
    await mkdir(join(t.dir, ".journeyproof/beta-prepare"), { recursive: true });
    await writeFile(
      join(t.dir, ".journeyproof/beta-prepare/manifest.json"),
      JSON.stringify({ status: "passed" }),
    );
    const result = await promisify(execFile)(
      process.execPath,
      [join(t.dir, "scripts/beta-prepare.mjs")],
      { cwd: t.dir, env: process.env },
    ).catch((error) => error);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Beta preparation failed");
    expect(
      JSON.parse(
        await readFile(
          join(t.dir, ".journeyproof/beta-prepare/manifest.json"),
          "utf8",
        ),
      ).status,
    ).toBe("failed");
    expect(await readdir(t.dir)).not.toContain("artifacts");
  } finally {
    await t.cleanup();
  }
});

it.each(["missing asset", ".env", "credential", "corrupt gzip"])(
  "beta verification exits nonzero for %s even with matching outer checksums",
  async (kind) => {
    const t = await temp();
    try {
      const plan = planBetaKit({
        archive: tarball(payload()),
        gate,
        rehearsal,
        sourceDigest: digest,
        buildDigest: build,
        node: process.version,
        platform: process.platform,
      });
      const files = payload();
      if (kind === "missing asset") files.delete("dist/cli.js");
      if (kind === ".env") files.set(".env", Buffer.from("synthetic=private"));
      if (kind === "credential")
        files.set("README.md", Buffer.from("npm_" + "a".repeat(40)));
      const archive =
        kind === "corrupt gzip" ? Buffer.from("invalid gzip") : tarball(files);
      const checksum = sha256(archive);
      const manifest = {
        ...plan.manifest,
        kitId: sha256(checksum + JSON.stringify(plan.manifest.evidence)).slice(
          0,
          20,
        ),
        files: plan.manifest.files.map((f) =>
          f.name === plan.archive
            ? { ...f, bytes: archive.length, sha256: checksum }
            : f,
        ),
      };
      const relative = `artifacts/beta/journeyproof-${manifest.version}-${manifest.kitId}`;
      const directory = join(t.dir, relative);
      await mkdir(directory, { recursive: true });
      // Write intentionally unsafe fixtures directly; the production writer refuses them.
      for (const [name, bytes] of Object.entries({
        ...plan.documents,
        [plan.archive]: archive,
        "SHA256SUMS.txt": `${checksum}  ${plan.archive}\n`,
        "beta-manifest.json": JSON.stringify(manifest),
      }))
        await writeFile(join(directory, name), bytes);
      // Exercise the real CLI wrapper against source through tsx, so a fresh
      // checkout need not have dist before the coverage suite's build step.
      const command = (
        await readFile("scripts/beta-verify.mjs", "utf8")
      ).replace(
        '"../dist/index.js"',
        JSON.stringify(pathToFileURL(resolve("src/distribution/beta.ts")).href),
      );
      const runner = join(t.dir, "verify.mjs");
      await writeFile(runner, command);
      const result = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
          runner,
          "--kit",
          relative,
        ],
        { cwd: t.dir },
      ).catch((error) => error);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("Beta verification failed");
      expect(result.stdout).not.toContain('"passed"');
      expect(await readFile(join(directory, plan.archive))).toEqual(archive);
    } finally {
      await t.cleanup();
    }
  },
);

it("includes LICENSE and NOTICE in source integrity proofs", async () => {
  const t = await temp();
  try {
    // A minimal source tree exercises the actual fingerprint helper without builds.
    const metadata = JSON.parse(await readFile("package.json", "utf8"));
    metadata.files = ["LICENSE", "NOTICE"];
    await writeFile(join(t.dir, "package.json"), JSON.stringify(metadata));
    for (const directory of ["src", "scripts", "tests", ".github/workflows"])
      await mkdir(join(t.dir, directory), { recursive: true });
    for (const file of [
      "package-lock.json",
      "tsconfig.json",
      "tsconfig.build.json",
      "tsup.config.ts",
      "vitest.config.ts",
      "playwright.config.ts",
      "regression.playwright.config.ts",
      "eslint.config.mjs",
      ".mcp/server.json.example",
      "LICENSE",
      "NOTICE",
    ]) {
      await mkdir(join(t.dir, file, ".."), { recursive: true });
      await cp(file, join(t.dir, file));
    }
    const module = pathToFileURL(resolve("scripts/lib/fingerprints.mjs")).href;
    const code = `import {fingerprints} from ${JSON.stringify(module)}; console.log(JSON.stringify(await fingerprints(process.cwd(), false)));`;
    const fingerprint = async () =>
      JSON.parse(
        (
          await promisify(execFile)(
            process.execPath,
            ["--input-type=module", "-e", code],
            { cwd: t.dir },
          )
        ).stdout,
      );
    const initial = await fingerprint();
    for (const file of ["LICENSE", "NOTICE"]) {
      const original = await readFile(join(t.dir, file));
      await writeFile(join(t.dir, file), "changed");
      expect((await fingerprint()).sourceDigest).not.toBe(initial.sourceDigest);
      await writeFile(join(t.dir, file), original);
      expect(await fingerprint()).toEqual(initial);
    }
  } finally {
    await t.cleanup();
  }
});
