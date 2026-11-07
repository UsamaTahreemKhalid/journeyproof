import { mkdir, writeFile, readFile, realpath, lstat } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { InputError } from "../shared/errors.js";

export const DEFAULT_OUTPUT = ".journeyproof/runs";
export async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink())
    throw new InputError("Artifact directory must not be a symlink");
  return resolve(path);
}
export async function writePrivate(file: string, data: string | Uint8Array) {
  // Atomic replacement also avoids following an existing final-file symlink.
  const { rename } = await import("node:fs/promises");
  const temp = file + ".tmp";
  await writeFile(temp, data, { mode: 0o600, flag: "wx" });
  await rename(temp, file);
}
export async function runDirectory(root: string, id: string, create = false) {
  if (!/^\d{13}-[a-f0-9]{8}$/.test(id))
    throw new InputError("Invalid run ID; use the ID printed by run");
  const base = await realpath(root);
  const dir = join(base, id);
  if (create) await mkdir(dir, { mode: 0o700 });
  const actual = await realpath(dir);
  if (actual !== dir || !actual.startsWith(base + sep))
    throw new InputError("Run directory escapes artifact root");
  return dir;
}
export async function readBounded(file: string, max = 2 * 1024 * 1024) {
  const info = await lstat(file);
  if (!info.isFile() || info.size > max)
    throw new InputError("Artifact must be a regular file within size limit");
  return readFile(file, "utf8");
}
