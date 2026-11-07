import { describe, it, expect } from "vitest";
import {
  parseJourney,
  resolveValues,
  loadJourney,
} from "../../src/config/load.js";
import { EXAMPLE_YAML } from "../../src/config/example.js";
import { journeySchema } from "../../src/config/schema.js";
const base = {
  schemaVersion: 1,
  name: "test",
  steps: [{ id: "open", action: "goto", path: "/" }],
};
describe("bounded YAML and schema", () => {
  it("loads the commented example", () =>
    expect(parseJourney(EXAMPLE_YAML).steps).toHaveLength(2));
  it.each([
    { ...base, schemaVersion: 2 },
    { ...base, surprise: true },
    { ...base, steps: [] },
    { ...base, steps: Array(101).fill(base.steps[0]) },
    { ...base, steps: [base.steps[0], base.steps[0]] },
    { ...base, steps: [{ id: "x", action: "shell", command: "echo no" }] },
    { ...base, steps: [{ id: "x", action: "goto", path: "//example.test" }] },
    { ...base, steps: [{ id: "x", action: "goto", path: "/a/../b" }] },
    { ...base, steps: [{ id: "x", action: "goto", path: "/%2e%2e" }] },
    { ...base, steps: [{ id: "x", action: "click", locator: { css: "#a" } }] },
    {
      ...base,
      steps: [
        {
          id: "x",
          action: "click",
          locator: { role: "button", name: "A", xpath: "//" },
        },
      ],
    },
    { ...base, steps: [{ id: "x", action: "fill", locator: { testId: "x" } }] },
    {
      ...base,
      steps: [
        {
          id: "x",
          action: "fill",
          locator: { testId: "x" },
          value: "x",
          valueFromEnv: "SECRET",
        },
      ],
    },
    {
      ...base,
      steps: [
        {
          id: "x",
          action: "fill",
          locator: { testId: "x" },
          value: "x",
          sensitive: true,
        },
      ],
    },
    {
      ...base,
      steps: [
        {
          id: "x",
          action: "click",
          locator: { role: "button", name: "A" },
          timeoutMs: 30001,
        },
      ],
    },
    { ...base, name: "a".repeat(501) },
  ])("rejects invalid configuration %#", (value) =>
    expect(() => parseJourney(JSON.stringify(value))).toThrow(),
  );
  it.each([
    "name: [",
    "name: a\nname: b",
    "x: &a abc\ny: *a",
    "x: !!str abc",
    "x: !weird abc",
    "x: *missing",
    "a".repeat(131073),
  ])("rejects surprising YAML %#", (yaml) =>
    expect(() => parseJourney(yaml)).toThrow(),
  );
  it("rejects a missing file without leaking its path", async () => {
    await expect(loadJourney("/missing/private/path")).rejects.toThrow(
      "Cannot read journey",
    );
  });
  it("resolves only explicit env references and treats every env value as secret", () => {
    const flow = journeySchema.parse({
      ...base,
      steps: [
        {
          id: "fill",
          action: "fill",
          locator: { testId: "password" },
          valueFromEnv: "DEMO_SECRET",
          sensitive: true,
        },
        {
          id: "literal",
          action: "fill",
          locator: { testId: "name" },
          value: "${NO_INTERPOLATION}",
        },
      ],
    });
    expect(() => resolveValues(flow, {})).toThrow("DEMO_SECRET");
    expect(() => resolveValues(flow, { DEMO_SECRET: "" })).toThrow("1–2000");
    expect(() =>
      resolveValues(flow, { DEMO_SECRET: "x".repeat(2001) }),
    ).toThrow("1–2000");
    const resolved = resolveValues(flow, { DEMO_SECRET: "fake-value" });
    expect(resolved.values).toEqual({
      fill: "fake-value",
      literal: "${NO_INTERPOLATION}",
    });
    expect(resolved.secrets).toEqual(["fake-value"]);
  });
});
