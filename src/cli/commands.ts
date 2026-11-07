import { writeFile, access, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { EXAMPLE_YAML } from "../config/example.js";
import { loadJourney } from "../config/load.js";
import { privateDirectory, writePrivate } from "../evidence/store.js";
import { InputError } from "../shared/errors.js";

export async function init(dir: string, force = false) {
  const root = await privateDirectory(join(resolve(dir), ".journeyproof"));
  const file = join(root, "example.yaml");
  try {
    if (force) await writePrivate(file, EXAMPLE_YAML);
    else await writeFile(file, EXAMPLE_YAML, { flag: "wx", mode: 0o600 });
  } catch {
    throw new InputError(
      "Example exists or cannot be written. Use --force to replace it",
    );
  }
  return file;
}
export function supportedNode(version: string) {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return major === 24 && minor! >= 11;
}
export async function doctor(
  outputDir: string,
  flow?: string,
  checkBrowser = true,
  workspace = process.env.JOURNEYPROOF_WORKSPACE_ROOT ?? process.cwd(),
) {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  checks.push({
    name: "Node",
    ok: supportedNode(process.versions.node),
    detail: `Found ${process.version}; use Node 24.11+ (24 LTS)`,
  });
  try {
    if (!(await stat(resolve(workspace))).isDirectory())
      throw new Error("Workspace is not a directory");
    checks.push({
      name: "Workspace",
      ok: true,
      detail:
        "Workspace directory exists; MCP/generation roots are fixed at startup",
    });
  } catch {
    checks.push({
      name: "Workspace",
      ok: false,
      detail: "Set JOURNEYPROOF_WORKSPACE_ROOT to an existing directory",
    });
  }
  if (checkBrowser)
    try {
      await access(chromium.executablePath(), constants.X_OK);
      const browser = await chromium.launch({ timeout: 10000 });
      await browser.close();
      checks.push({
        name: "Chromium",
        ok: true,
        detail: "Chromium launched successfully",
      });
    } catch {
      checks.push({
        name: "Chromium",
        ok: false,
        detail:
          "Install browser and OS libraries: npx playwright install --with-deps chromium",
      });
    }
  try {
    const root = await privateDirectory(outputDir);
    const probe = join(root, `.write-probe-${randomUUID()}`);
    await writeFile(probe, "", { mode: 0o600, flag: "wx" });
    await rm(probe);
    checks.push({
      name: "Artifacts",
      ok: true,
      detail: "Artifact location is writable",
    });
  } catch {
    checks.push({
      name: "Artifacts",
      ok: false,
      detail: "Choose a writable --output-dir",
    });
  }
  if (flow) {
    try {
      await loadJourney(flow);
      checks.push({ name: "Journey", ok: true, detail: "Journey is valid" });
    } catch {
      checks.push({
        name: "Journey",
        ok: false,
        detail:
          "Check journey path and YAML schema; see docs/JOURNEY_SCHEMA.md",
      });
    }
  }
  return { ok: checks.every((check) => check.ok), checks };
}
export async function openReport(
  file: string,
  platform = process.platform,
): Promise<boolean> {
  const command =
    platform === "darwin"
      ? "open"
      : platform === "linux"
        ? "xdg-open"
        : undefined;
  if (!command) return false;
  return new Promise((resolve) => {
    const child = spawn(command, [pathToFileURL(file).href], {
      stdio: "ignore",
      shell: false,
    });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 5000);
    timer.unref();
    child.once("close", () => clearTimeout(timer));
  });
}
