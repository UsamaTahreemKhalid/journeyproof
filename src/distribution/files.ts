import {
  mkdir,
  writeFile,
  rm,
  readdir,
  lstat,
  readFile,
} from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { checkedPath } from "../map/storage.js";
import { InputError } from "../shared/errors.js";
// Internal helper: callers validate fixed relative directory/file names before writing.
export async function stageCandidate(
  root: string,
  path: string,
  files: Map<string, Buffer>,
) {
  const target = await checkedPath(resolve(root, path), true);
  const parent = await checkedPath(dirname(target), true);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await checkedPath(parent);
  try {
    await mkdir(target, { mode: 0o700 });
  } catch {
    throw new InputError(
      "Candidate already exists or output is unavailable; existing candidates are never overwritten",
    );
  }
  try {
    for (const [name, bytes] of files)
      await writeFile(join(target, name), bytes, { flag: "wx", mode: 0o600 });
    return target;
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}
export async function readCandidate(root: string, path: string, count: number) {
  const directory = await checkedPath(resolve(root, path));
  const names = await readdir(directory);
  if (names.length !== count)
    throw new InputError("Unexpected or missing kit file");
  const files = new Map<string, Buffer>();
  for (const name of names) {
    const file = await checkedPath(join(directory, name));
    const info = await lstat(file);
    if (!info.isFile() || info.size > 3 * 1024 * 1024)
      throw new InputError("Invalid candidate artifact size/type");
    files.set(name, await readFile(file));
  }
  return { directory, files };
}
