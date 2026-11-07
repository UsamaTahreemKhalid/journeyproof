import { it, expect } from "vitest";
import { readFile, access, cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { temp } from "../helpers.js";
import { HELP, parseArgs } from "../../src/cli/args.js";
import { skillFrontmatter } from "../../scripts/lib/skill-frontmatter.mjs";

it("validates portable Agent Skills metadata and every local reference", async () => {
  const root = "skills/journeyproof";
  const text = await readFile(join(root, "SKILL.md"), "utf8");
  const metadata = parse(skillFrontmatter(text));
  expect(Object.keys(metadata).sort()).toEqual(["description", "name"]);
  expect(metadata.name).toBe("journeyproof");
  expect(metadata.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  expect(metadata.name.length).toBeLessThanOrEqual(64);
  expect(metadata.description.length).toBeGreaterThan(1);
  expect(metadata.description.length).toBeLessThanOrEqual(1024);
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    expect(match[1]).not.toContain("..");
    await access(join(root, match[1]!));
  }
  expect(text.split("\n").length).toBeLessThan(100);
});
it.each(["\n", "\r\n"])(
  "parses Skill frontmatter with %j line endings and rejects invalid files",
  (newline) => {
    const skill = [
      "---",
      "name: journeyproof",
      "description: Verify journeys",
      "---",
      "Use the skill.",
    ].join(newline);
    expect(parse(skillFrontmatter(skill))).toEqual({
      name: "journeyproof",
      description: "Verify journeys",
    });
    expect(() => skillFrontmatter("name: journeyproof")).toThrow("frontmatter");
    expect(() =>
      skillFrontmatter(["---", "name: journeyproof", "---", ""].join(newline)),
    ).toThrow("body");
  },
);
it("installs a self-contained skill in supported project directories without stale references", async () => {
  const t = await temp();
  try {
    for (const host of [".agents", ".claude"]) {
      const destination = join(t.dir, host, "skills/journeyproof");
      await mkdir(join(t.dir, host, "skills"), { recursive: true });
      await cp("skills/journeyproof", destination, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      const text = await readFile(join(destination, "SKILL.md"), "utf8");
      for (const match of text.matchAll(/\]\(([^)]+)\)/g))
        await access(join(destination, match[1]!));
    }
  } finally {
    await t.cleanup();
  }
});
it("checks documented CLI fallback and bundled package paths against the actual command parser", async () => {
  expect(parseArgs(["mcp"]).command).toBe("mcp");
  expect(HELP).toContain("journeyproof mcp");
  expect(
    parseArgs([
      "doctor",
      "--flow",
      "examples/admissions-demo/journeys/happy-path.yaml",
    ]).command,
  ).toBe("doctor");
  expect(
    parseArgs([
      "run",
      "--flow",
      "examples/admissions-demo/journeys/happy-path.yaml",
      "--json",
    ]).command,
  ).toBe("run");
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  expect(pkg.bin.journeyproof).toBe("dist/cli.js");
  expect(pkg.files).toContain("skills");
});
