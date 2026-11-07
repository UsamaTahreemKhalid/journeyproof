import { lstat, realpath, mkdir, readFile } from "node:fs/promises";
import { resolve, join, parse, relative, dirname } from "node:path";
import { MapError } from "./errors.js";
export async function checkedPath(path: string, allowMissing = false) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute)
    .split(/[\\/]/)
    .filter(Boolean)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new MapError("PATH_DENIED");
      const canonical = await realpath(current);
      // Windows may expand an 8.3 name (RUNNER~1) or normalize casing.
      // Compare canonical parents so an alias can only name an entry in the
      // already-checked directory; links and junctions remain forbidden.
      const sameParent =
        dirname(canonical).toLowerCase() === dirname(current).toLowerCase();
      if (process.platform === "win32" ? !sameParent : canonical !== current)
        throw new MapError("PATH_DENIED");
      current = canonical;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !allowMissing)
        throw error instanceof MapError ? error : new MapError("MISSING_RUN");
    }
  }
  return current;
}
export async function regularFile(
  file: string,
  limit: number,
): Promise<boolean> {
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new MapError("PATH_DENIED");
    if (!info.isFile() || info.size > limit)
      throw new MapError("LIMIT_EXCEEDED");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
export async function readJson(file: string, limit: number) {
  if (!(await regularFile(file, limit))) throw new MapError("MISSING_RUN");
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    throw new MapError("INVALID_ARTIFACT");
  }
}
export async function mapRoot(runRoot: string, create: boolean) {
  const root = await checkedPath(runRoot);
  if (!(await lstat(root)).isDirectory()) throw new MapError("PATH_DENIED");
  const maps = await checkedPath(join(root, "maps"), create);
  if (create) await mkdir(maps, { recursive: true, mode: 0o700 });
  return maps;
}
