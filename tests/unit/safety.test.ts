import { it, expect } from "vitest";
import {
  safePath,
  pathMatches,
  baseOrigin,
  safeUrl,
  redact,
  redactObject,
  escapeHtml,
} from "../../src/shared/safety.js";
import { errorText, exitCode } from "../../src/shared/errors.js";
import { summarize } from "../../src/shared/types.js";
import { sampleRun } from "../helpers.js";
it.each([
  "//evil.test",
  "/../a",
  "/a/./b",
  "/a?secret=x",
  "/a#x",
  "/a\\b",
  "/a/%2f/b",
  "file:///etc/passwd",
])("rejects unsafe path %s", (path) => expect(safePath(path)).toBe(false));
it("uses only a single-segment wildcard", () => {
  expect(pathMatches("/a/*/approve", "/a/12/approve")).toBe(true);
  expect(pathMatches("/a/*/approve", "/a/1/2/approve")).toBe(false);
  expect(pathMatches("/a.b", "/axb")).toBe(false);
});
it.each([
  "file:///tmp/a",
  "https://user:pass@a.test",
  "https://a.test/path",
  "https://a.test?secret=x",
  "x",
  "http://localhost.evil.test",
])("rejects unsafe origin %s", (url) =>
  expect(() => baseOrigin(url)).toThrow(),
);
it("requires opt-in for remote initial origins", () => {
  expect(() => baseOrigin("https://example.test")).toThrow("--allow-remote");
  expect(baseOrigin("https://example.test", true)).toBe("https://example.test");
  expect(baseOrigin("http://[::1]:4173")).toBe("http://[::1]:4173");
});
it("redacts secrets, encoded secrets, URL credentials and query parameters", () => {
  const text = redact(
    "token=secret/a https://u:p@a.test/path?token=secret%2Fa#frag",
    ["secret/a"],
  );
  expect(text).not.toContain("secret");
  expect(text).not.toContain("u:p");
  expect(text).not.toContain("?");
  expect(safeUrl("https://a.test/a?token=x#b")).toBe("https://a.test/a");
  expect(safeUrl("bad")).toBe("[invalid URL]");
});
it("redacts objects without corrupting escaped JSON strings", () => {
  const input = { message: 'password is a"b', arr: ['a"b', 4, null] };
  expect(redactObject(input, ['a"b', ""])).toEqual({
    message: "password is [REDACTED]",
    arr: ["[REDACTED]", 4, null],
  });
});
it("escapes report HTML and attributes", () =>
  expect(escapeHtml("<script>\"&'</script>")).toBe(
    "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;",
  ));
it("maps errors and exit codes", () => {
  expect(errorText(new Error("failure"))).toBe("failure");
  expect(errorText("other")).toBe("other");
  expect(
    ["passed", "failed", "error"].map((s) =>
      exitCode(s as "passed" | "failed" | "error"),
    ),
  ).toEqual([0, 1, 2]);
});
it("counts actual statuses", () => {
  const run = sampleRun();
  run.steps.push(
    { ...run.steps[0]!, status: "failed" },
    { ...run.steps[0]!, status: "skipped" },
  );
  expect(summarize(run)).toEqual({ passed: 1, failed: 1, skipped: 1 });
});
