import { describe, it, expect } from "vitest";
import { writeFile, readFile, mkdir, symlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { temp, sampleRun } from "../helpers.js";
import { init, doctor, openReport } from "../../src/cli/commands.js";
import { main } from "../../src/cli/main.js";
import { loadJourney } from "../../src/config/load.js";
import { writeReport, regenerateReport } from "../../src/report/write.js";
import {
  privateDirectory,
  runDirectory,
  readBounded,
  writePrivate,
} from "../../src/evidence/store.js";

describe("local file and CLI contracts", () => {
  it("initializes, loads YAML, refuses overwrite, and supports explicit force", async () => {
    const t = await temp();
    try {
      const file = await init(t.dir);
      expect((await loadJourney(file)).journey.name).toBe("first-journey");
      await expect(init(t.dir)).rejects.toThrow("exists");
      await init(t.dir, true);
      expect((await stat(file)).mode & 0o077).toBe(0);
      await writeFile(file, "x".repeat(131073));
      await expect(loadJourney(file)).rejects.toThrow("128 KiB");
    } finally {
      await t.cleanup();
    }
  });
  it("writes standalone reports and safely regenerates an existing report", async () => {
    const t = await temp();
    try {
      const run = sampleRun();
      const dir = await runDirectory(t.dir, run.id, true);
      const paths = await writeReport(dir, run);
      expect(JSON.parse(await readFile(paths.json, "utf8"))).toEqual(run);
      expect(await readFile(paths.html, "utf8")).toContain("Page opened");
      expect(await regenerateReport(t.dir, run.id)).toEqual(paths);
      await writeFile(
        paths.json,
        JSON.stringify({ ...run, id: "1793730000000-aaaa0000" }),
      );
      await expect(regenerateReport(t.dir, run.id)).rejects.toThrow(
        "mismatched",
      );
      await writeFile(paths.json, "{}");
      await expect(regenerateReport(t.dir, run.id)).rejects.toThrow("Invalid");
    } finally {
      await t.cleanup();
    }
  });
  it("rejects traversal, symlink escapes, oversized and symlink artifacts", async () => {
    const t = await temp();
    try {
      await expect(runDirectory(t.dir, "../../etc")).rejects.toThrow(
        "Invalid run ID",
      );
      const outside = join(t.dir, "outside");
      await mkdir(outside);
      const id = sampleRun().id;
      await symlink(outside, join(t.dir, id));
      await expect(runDirectory(t.dir, id)).rejects.toThrow("escapes");
      await expect(privateDirectory(join(t.dir, id))).rejects.toThrow(
        "symlink",
      );
      const file = join(t.dir, "big");
      await writeFile(file, "big");
      await expect(readBounded(file, 1)).rejects.toThrow("size limit");
      await symlink(file, join(t.dir, "linked"));
      await expect(readBounded(join(t.dir, "linked"))).rejects.toThrow(
        "regular file",
      );
      await writePrivate(join(t.dir, "private"), "safe");
      expect((await stat(join(t.dir, "private"))).mode & 0o077).toBe(0);
    } finally {
      await t.cleanup();
    }
  });
  it("doctor actually launches Chromium and checks good and invalid workflows and output locations", async () => {
    const t = await temp();
    try {
      const flow = await init(t.dir);
      expect((await doctor(join(t.dir, "runs"), flow)).ok).toBe(true);
      const bad = await doctor(join(t.dir, "runs"), "missing.yaml");
      expect(bad.ok).toBe(false);
      expect(bad.checks.at(-1)?.name).toBe("Journey");
      const file = join(t.dir, "file");
      await writeFile(file, "x");
      expect(
        (await doctor(file)).checks.find((c) => c.name === "Artifacts")?.ok,
      ).toBe(false);
    } finally {
      await t.cleanup();
    }
  });
  it("CLI emits one JSON object and actionable input errors without noisy stdout", async () => {
    const t = await temp();
    try {
      const out: string[] = [];
      const err: string[] = [];
      const io = {
        out: (s: string) => out.push(s),
        err: (s: string) => err.push(s),
      };
      expect(await main(["--help"], io)).toBe(0);
      expect(out.pop()).toContain("Usage");
      expect(await main(["--version"], io)).toBe(0);
      expect(out.pop()).toBe("0.1.0-rc.2");
      expect(await main(["init", "--dir", t.dir], io)).toBe(0);
      expect(out.pop()).toContain("Next:");
      expect(await main(["run", "--flow", "missing.yaml", "--json"], io)).toBe(
        2,
      );
      expect(JSON.parse(out.pop()!).exitCode).toBe(2);
      expect(err).toEqual([]);
      expect(await main(["nonsense"], io)).toBe(2);
      expect(err.pop()).toContain("Unknown");
      expect(
        await main(
          ["doctor", "--output-dir", join(t.dir, "runs"), "--json"],
          io,
        ),
      ).toBe(0);
      expect(JSON.parse(out.pop()!).ok).toBe(true);
      expect(
        await main(
          ["doctor", "--output-dir", join(t.dir, "runs"), "--flow", "missing"],
          io,
        ),
      ).toBe(2);
      expect(out.pop()).toContain("FAIL Journey");
      const run = sampleRun();
      const dir = await runDirectory(join(t.dir, "runs"), run.id, true);
      await writeReport(dir, run);
      expect(
        await main(
          ["report", "--output-dir", join(t.dir, "runs"), "--run", run.id],
          io,
        ),
      ).toBe(0);
      expect(out.pop()).toContain("index.html");
      await writeFile(join(dir, "run.json"), "bad json");
      expect(
        await main(
          ["report", "--output-dir", join(t.dir, "runs"), "--run", run.id],
          io,
        ),
      ).toBe(2);
      expect(err.pop()).toContain("Tool could not");
      expect(await openReport("/tmp/fake.html", "win32")).toBe(false);
    } finally {
      await t.cleanup();
    }
  });
});
