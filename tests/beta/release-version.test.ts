import { it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
it("binds dispatch, package, lockfile, CLI and MCP versions to reviewed source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jp-version-"));
  try {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
    const server = JSON.parse(
      await readFile(".mcp/server.json.example", "utf8"),
    );
    await mkdir(join(dir, ".mcp"));
    const write = async () => {
      await writeFile(join(dir, "package.json"), JSON.stringify(pkg));
      await writeFile(join(dir, "package-lock.json"), JSON.stringify(lock));
      await writeFile(
        join(dir, ".mcp/server.json.example"),
        JSON.stringify(server),
      );
    };
    const run = (version: string, clear = false) =>
      execute(
        process.execPath,
        [
          "--import",
          resolve("node_modules/tsx/dist/loader.mjs"),
          resolve("scripts/release-version.mjs"),
          ...(clear ? ["--clear-output"] : []),
        ],
        {
          cwd: dir,
          env: { ...process.env, APPROVED_VERSION: version, GITHUB_OUTPUT: "" },
          timeout: 10000,
        },
      );
    await write();
    await expect(run(pkg.version)).resolves.toBeDefined();
    await mkdir(join(dir, ".journeyproof/npm-mcp-release/artifact"), {
      recursive: true,
    });
    await writeFile(
      join(dir, ".journeyproof/npm-mcp-release/artifact/manifest.json"),
      "stale",
    );
    await writeFile(
      join(dir, ".journeyproof/npm-mcp-release/artifact/smoke.json"),
      "stale",
    );
    await expect(run("0.1.0-rc.999", true)).rejects.toThrow();
    await expect(
      readFile(
        join(dir, ".journeyproof/npm-mcp-release/artifact/manifest.json"),
      ),
    ).rejects.toThrow();
    await expect(
      readFile(join(dir, ".journeyproof/npm-mcp-release/artifact/smoke.json")),
    ).rejects.toThrow();
    lock.packages[""].version = "1.0.0";
    await write();
    await expect(run(pkg.version)).rejects.toThrow();
    lock.packages[""].version = pkg.version;
    server.packages[0].version = "1.0.0";
    await write();
    await expect(run(pkg.version)).rejects.toThrow();
    server.packages[0].version = pkg.version;
    pkg.version = "1.0.0";
    await write();
    await expect(run("1.0.0")).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
