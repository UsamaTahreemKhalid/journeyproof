import { readdir, lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
export async function fingerprints(root = process.cwd(), requireBuild = true) {
  const metadata = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const sourceFiles = new Set();
  async function collect(path) {
    if (/^tests\/generated\/admissions-.*\.spec\.ts$/.test(path)) return;
    const info = await lstat(join(root, path));
    if (info.isSymbolicLink())
      throw new Error("Validation inputs must not be symlinks");
    if (info.isDirectory()) {
      for (const name of (await readdir(join(root, path))).sort())
        await collect(path + "/" + name);
    } else if (info.isFile()) sourceFiles.add(path);
    if (sourceFiles.size > 1500)
      throw new Error("Validation input budget exceeded");
  }
  for (const path of [
    "src",
    "scripts",
    "tests",
    ".github/workflows",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.build.json",
    "tsup.config.ts",
    "vitest.config.ts",
    "playwright.config.ts",
    "regression.playwright.config.ts",
    "eslint.config.mjs",
    ".mcp/server.json.example",
    ...metadata.files.filter((p) => p !== "dist"),
  ])
    await collect(path);
  async function digest(files) {
    const hash = createHash("sha256");
    for (const path of [...files].sort()) {
      hash.update(path + "\0");
      hash.update(await readFile(join(root, path)));
    }
    return hash.digest("hex");
  }
  const build = [];
  let names;
  try {
    names = (await readdir(join(root, "dist"))).sort();
  } catch (error) {
    if (requireBuild || error.code !== "ENOENT") throw error;
    names = [];
  }
  async function collectBuild(file) {
    const info = await lstat(join(root, file));
    if (info.isSymbolicLink()) throw new Error("Unexpected build symlink");
    if (info.isDirectory()) {
      for (const name of (await readdir(join(root, file))).sort())
        await collectBuild(file + "/" + name);
    } else if (info.isFile()) build.push(file);
    else throw new Error("Unexpected build asset");
    if (build.length > 200) throw new Error("Build asset budget exceeded");
  }
  for (const name of names) await collectBuild("dist/" + name);
  return {
    sourceDigest: await digest(sourceFiles),
    buildDigest: await digest(build),
  };
}
