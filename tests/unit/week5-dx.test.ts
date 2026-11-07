import { it, expect, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { doctor, supportedNode } from "../../src/cli/commands.js";
import { main } from "../../src/cli/main.js";
import { parseArgs, COMMAND_HELP } from "../../src/cli/args.js";
import { parseJourney } from "../../src/config/load.js";
import { temp } from "../helpers.js";
it("offers help for every command and keeps Node/platform requirements explicit", async () => {
  for (const command of Object.keys(COMMAND_HELP)) {
    expect(parseArgs([command, "--help"]).command).toBe("help");
    const out: string[] = [];
    expect(
      await main([command, "--help"], {
        out: (s) => out.push(s),
        err: () => {},
      }),
    ).toBe(0);
    expect(out[0]).toContain(COMMAND_HELP[command]);
  }
  for (const version of ["24.11.0", "24.22.0", "v24.99.0"])
    expect(supportedNode(version)).toBe(true);
  for (const version of ["22.14.0", "24.10.9", "25.0.0", "26.0.0", "garbage"])
    expect(supportedNode(version)).toBe(false);
  const path = win32.join(
    "C:\\Users\\Example Project",
    "node_modules",
    "journeyproof",
    "dist",
    "cli.js",
  );
  expect(win32.basename(path)).toBe("cli.js");
  expect(
    fileURLToPath(
      pathToFileURL(join(process.cwd(), "folder with spaces", "cli.js")),
    ),
  ).toBe(join(process.cwd(), "folder with spaces", "cli.js"));
});
it("checks workspace and artifact writability without launching a browser in lightweight mode", async () => {
  const t = await temp();
  try {
    const result = await doctor(join(t.dir, "runs"), undefined, false, t.dir);
    expect(result.ok).toBe(true);
    expect(result.checks.some((c) => c.name === "Chromium")).toBe(false);
    expect(result.checks.find((c) => c.name === "Workspace")!.ok).toBe(true);
    expect(
      (
        await doctor(
          join(t.dir, "runs"),
          undefined,
          false,
          join(t.dir, "missing"),
        )
      ).ok,
    ).toBe(false);
    const file = join(t.dir, "file");
    await writeFile(file, "x");
    expect((await doctor(join(t.dir, "runs"), undefined, false, file)).ok).toBe(
      false,
    );
    const out: string[] = [];
    expect(
      await main(
        [
          "doctor",
          "--no-browser",
          "--output-dir",
          join(t.dir, "runs"),
          "--json",
        ],
        { out: (s) => out.push(s), err: () => {} },
      ),
    ).toBe(0);
    expect(
      JSON.parse(out[0]!).checks.some(
        (c: { name: string }) => c.name === "Workspace",
      ),
    ).toBe(true);
  } finally {
    await t.cleanup();
  }
});
it("returns actionable report and workspace diagnostics without raw filesystem/browser text", async () => {
  const out: string[] = [],
    err: string[] = [];
  const io = {
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  };
  expect(
    await main(
      [
        "report",
        "--run",
        "1793730000000-abcd1234",
        "--output-dir",
        "missing-private-location",
      ],
      io,
    ),
  ).toBe(2);
  expect(err.pop()).toContain("original --output-dir");
  const t = await temp();
  const saved = process.env.JOURNEYPROOF_FLOW_ROOT;
  try {
    process.env.JOURNEYPROOF_FLOW_ROOT = "../private";
    expect(
      await main(["generate-test", "--flow", "whatever", "--json"], io),
    ).toBe(2);
    expect(JSON.parse(out.pop()!).error).toContain("Workspace policy");
  } finally {
    if (saved === undefined) delete process.env.JOURNEYPROOF_FLOW_ROOT;
    else process.env.JOURNEYPROOF_FLOW_ROOT = saved;
    await t.cleanup();
  }
});
it("schema errors never echo attacker-controlled field names into CLI diagnostics", () => {
  const payload = "private-token-that-must-not-echo";
  try {
    parseJourney(
      JSON.stringify({
        schemaVersion: 1,
        name: "example",
        steps: [{ id: "a", action: "goto", path: "/" }],
        [payload]: "secret",
      }),
    );
    throw Error("not rejected");
  } catch (error) {
    expect((error as Error).message).toContain("Invalid journey");
    expect(JSON.stringify(error)).not.toContain(payload);
    expect((error as Error).message).not.toContain(payload);
  }
});
it("doctor reports a genuinely absent browser without auto-installing", async () => {
  const t = await temp();
  const { chromium } = await import("playwright");
  const path = vi
    .spyOn(chromium, "executablePath")
    .mockReturnValue(join(t.dir, "absent-browser"));
  try {
    const result = await doctor(join(t.dir, "runs"));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "Chromium")!.detail).toContain(
      "playwright install",
    );
  } finally {
    path.mockRestore();
    await t.cleanup();
  }
});
