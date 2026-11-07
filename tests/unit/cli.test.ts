import { it, expect } from "vitest";
import { parseArgs, HELP } from "../../src/cli/args.js";
it.each(
  [
    ["unknown"],
    ["run"],
    ["report"],
    ["run", "--flow"],
    ["run", "--flow", "--json"],
    ["run", "--flow", "a", "--flow", "b"],
    ["init", "--nope"],
    ["run", "a"],
    ["run", "--flow", "a", "--timeout-ms", "NaN"],
    ["run", "--flow", "a", "--timeout-ms", "99"],
    ["run", "--flow", "a", "--timeout-ms", "30001"],
  ].map((args) => ({ args })),
)("rejects invalid arguments %#", ({ args }) =>
  expect(() => parseArgs(args)).toThrow(),
);
it("parses help, version and flags", () => {
  expect(parseArgs([]).command).toBe("help");
  expect(parseArgs(["--help"]).command).toBe("help");
  expect(parseArgs(["--version"]).command).toBe("version");
  expect(
    parseArgs([
      "run",
      "--flow",
      "a",
      "--json",
      "--timeout-ms",
      "100",
      "--headed",
      "--allow-remote",
    ]).flags,
  ).toEqual({
    flow: "a",
    json: true,
    "timeout-ms": "100",
    headed: true,
    "allow-remote": true,
  });
  expect(HELP).toContain("Exit codes");
});
