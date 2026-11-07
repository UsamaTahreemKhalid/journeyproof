import { it, expect } from "vitest";
import { strToU8, strFromU8, zipSync, unzipSync } from "fflate";
import { sanitizeTrace } from "../../src/evidence/trace.js";
it("strips resources and network payloads and redacts action values and secrets", () => {
  const raw = zipSync({
    "trace.trace": strToU8(
      [
        {
          type: "before",
          params: {
            value: "secret",
            text: "secret",
            url: "https://a.test/?token=secret",
          },
        },
        { type: "after", error: { message: 'a"b secret' } },
        { type: "console", text: "secret" },
        { type: "event", params: { cookie: "x" } },
        { type: "input", text: "x" },
      ]
        .map((x) => JSON.stringify(x))
        .join("\n"),
    ),
    "trace.network": strToU8("secret headers body"),
    "resources/foo": strToU8("secret"),
  });
  const out = unzipSync(sanitizeTrace(raw, ["secret", 'a"b']));
  expect(Object.keys(out)).toEqual(["trace.trace", "trace.network"]);
  expect(strFromU8(out["trace.trace"]!)).not.toContain("secret");
  expect(strFromU8(out["trace.trace"]!)).not.toContain("token");
  expect(strFromU8(out["trace.trace"]!)).not.toContain("console");
  expect(out["trace.network"]!.length).toBe(0);
});
it("rejects unsupported or oversized archives", () => {
  expect(() => sanitizeTrace(zipSync({}), [])).toThrow("No supported");
  expect(() => sanitizeTrace(new Uint8Array(12 * 1024 * 1024 + 1), [])).toThrow(
    "12 MiB",
  );
});
