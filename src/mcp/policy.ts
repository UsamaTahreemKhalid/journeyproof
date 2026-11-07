import { lstat, realpath, mkdir } from "node:fs/promises";
import { resolve, join, relative, sep, isAbsolute } from "node:path";
import { baseOrigin } from "../shared/safety.js";

export class PolicyError extends Error {
  constructor(
    public readonly code:
      "PATH_DENIED" | "LOCAL_ONLY" | "BUSY" | "INVALID_FLOW" | "UNAVAILABLE",
    public readonly diagnostics?: { path: string; code: string }[],
  ) {
    super(code);
  }
}
const DEFAULT_FLOWS = "examples/admissions-demo/journeys";
export function relativePath(path: string) {
  if (
    !path ||
    path.length > 240 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    !/^[a-zA-Z0-9_. /-]+$/.test(path) ||
    path
      .split("/")
      .some(
        (p) =>
          !p || p === "." || p === ".." || p.startsWith(".") || p.length > 100,
      )
  )
    throw new PolicyError("PATH_DENIED");
  return path;
}
export class WorkspacePolicy {
  readonly artifacts: string;
  private constructor(
    readonly root: string,
    readonly flowDirectory: string,
  ) {
    this.artifacts = join(root, ".journeyproof", "runs");
  }
  static async create(
    root = process.env.JOURNEYPROOF_WORKSPACE_ROOT ?? process.cwd(),
    flowDirectory = process.env.JOURNEYPROOF_FLOW_ROOT ?? DEFAULT_FLOWS,
  ) {
    relativePath(flowDirectory);
    const actual = await realpath(resolve(root));
    if (!(await lstat(actual)).isDirectory())
      throw new PolicyError("PATH_DENIED");
    const policy = new WorkspacePolicy(actual, flowDirectory);
    await policy.checked(flowDirectory, false);
    return policy;
  }
  // Check every component, including non-existent output ancestors, before any writes.
  private async checked(path: string, mustExist = true) {
    let current = this.root;
    for (const part of path.split("/")) {
      current = join(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink() || (await realpath(current)) !== current)
          throw new PolicyError("PATH_DENIED");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || mustExist)
          throw new PolicyError("PATH_DENIED");
      }
    }
    return current;
  }
  async flow(path: string, directory = false) {
    relativePath(path);
    if (
      path !== this.flowDirectory &&
      !path.startsWith(this.flowDirectory + "/")
    )
      throw new PolicyError("PATH_DENIED");
    if (!directory && !/\.ya?ml$/.test(path))
      throw new PolicyError("PATH_DENIED");
    const file = await this.checked(path);
    const info = await lstat(file);
    if (directory ? !info.isDirectory() : !info.isFile())
      throw new PolicyError("PATH_DENIED");
    return file;
  }
  async artifactRoot(create: boolean) {
    await this.checked(".journeyproof/runs", !create);
    if (create) await mkdir(this.artifacts, { recursive: true, mode: 0o700 });
    await this.checked(".journeyproof/runs");
    return this.artifacts;
  }
  location(file: string) {
    const path = relative(this.root, file);
    if (path.startsWith("..") || isAbsolute(path))
      throw new PolicyError("PATH_DENIED");
    return path.split(sep).join("/");
  }
  origin(value: string, allowRemote = false) {
    if (allowRemote) throw new PolicyError("LOCAL_ONLY");
    let origin: string;
    try {
      origin = baseOrigin(value);
    } catch {
      throw new PolicyError("LOCAL_ONLY");
    }
    // Numeric loopback avoids DNS resolution/rebinding, including localhost overrides.
    if (!["127.0.0.1", "[::1]"].includes(new URL(origin).hostname))
      throw new PolicyError("LOCAL_ONLY");
    return origin;
  }
  async discover(directory = this.flowDirectory, limit = 20) {
    await this.flow(directory, true);
    const queue = [{ path: directory, depth: 0 }];
    const paths: string[] = [];
    let visited = 0;
    let truncated = false;
    while (queue.length) {
      const next = queue.shift()!;
      const handle = await this.flow(next.path, true);
      // opendir would avoid allocating an arbitrarily large directory; use bounded iteration.
      const { opendir } = await import("node:fs/promises");
      const entries = await opendir(handle);
      for await (const entry of entries) {
        if (++visited > 500) {
          truncated = true;
          break;
        }
        if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
        const path = next.path + "/" + entry.name;
        try {
          relativePath(path);
        } catch {
          continue;
        }
        if (entry.isDirectory() && next.depth < 5)
          queue.push({ path, depth: next.depth + 1 });
        else if (entry.isDirectory()) truncated = true;
        else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) {
          paths.push(path);
          if (paths.length >= limit) {
            truncated = true;
            break;
          }
        }
      }
      if (truncated && (visited > 500 || paths.length >= limit)) break;
    }
    return { paths: paths.sort(), truncated };
  }
}
