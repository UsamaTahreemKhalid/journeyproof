import { it, expect } from "vitest";
import ts from "typescript";
import { format } from "prettier";
import { toPlan, responseProven } from "../../src/regression/from-journey.js";
import { planSchema } from "../../src/regression/model.js";
import {
  emitPlaywright,
  literal,
} from "../../src/regression/emit-playwright.js";
import { journeySchema } from "../../src/config/schema.js";
import { journey, checksum, source } from "./fixtures.js";
it("emits deterministic formatted code for every supported action, preserving declared expectations", async () => {
  const plan = toPlan(journey, checksum, source());
  expect(plan.eligible).toBe(true);
  const code = await emitPlaywright(plan);
  expect(code).toBe(await emitPlaywright(plan));
  expect(code).toBe(await format(code, { parser: "typescript" }));
  expect(code).toMatchSnapshot();
  expect(code).not.toContain("private-literal");
  expect(code).toContain('getByLabel("Email", { exact: true })');
  expect(code).toContain(
    'getByRole("button", { name: "Approve", exact: true })',
  );
  expect(code).toContain('text: "Approved", contains: false');
  expect(code).toContain("normalize(readText(element))");
  expect(code).toContain("actual === wanted");
  expect(code).not.toContain(".toHaveText(");
  expect(code.indexOf("page.waitForResponse")).toBeLessThan(
    code.lastIndexOf(".click({ timeout })"),
  );
  const next = structuredClone(journey);
  next.steps.push({
    id: "contains",
    action: "expectText",
    locator: { testId: "result" },
    text: "Saved",
    contains: true,
  });
  const changed = await emitPlaywright(toPlan(next, checksum));
  expect(changed).toContain('text: "Saved", contains: true');
  expect(changed).toContain("actual.includes(wanted)");
  expect(changed).not.toContain(".toContainText(");
  expect(changed).not.toBe(code);
  expect(
    ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true)
      .statements.length,
  ).toBeGreaterThan(3);
});
it("serializes hostile strings as data and withholds all fill literals", async () => {
  const payload =
    "\"'` ${process.exit(99)} </script> $(touch /tmp/pwned) \u001b[31m\nسلام\u2028";
  expect(JSON.parse(literal(payload))).toBe(payload);
  const input = structuredClone(journey);
  input.steps[3] = {
    id: "click",
    action: "click",
    locator: { testId: payload },
  };
  const code = await emitPlaywright(toPlan(input, checksum));
  expect(code).toContain("\\u003c/script>");
  const file = ts.createSourceFile(
    "test.ts",
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  expect(found).toContain(payload);
  const privateInput = structuredClone(journey);
  privateInput.steps[2] = {
    id: "literal",
    action: "fill",
    locator: { testId: "input" },
    value: payload,
  };
  expect(await emitPlaywright(toPlan(privateInput, checksum))).not.toContain(
    "touch /tmp/pwned",
  );
});
it("blocks action-only endings, failed/legacy/mismatched/truncated runs and missing HTTP proof", async () => {
  const onlyClick = { ...journey, steps: [journey.steps[3]!] };
  const plan = toPlan(onlyClick, checksum);
  expect(plan.diagnostics).toContain("NO_FINAL_OUTCOME");
  await expect(emitPlaywright(plan)).rejects.toThrow("not eligible");
  for (const variant of [
    "failed",
    "legacy",
    "checksum",
    "skipped",
    "truncated",
    "observation",
    "role",
    "declarations",
  ]) {
    const s = source();
    if (variant === "failed") s.run.status = "failed";
    if (variant === "legacy") delete s.observations;
    if (variant === "checksum") s.run.metadata.checksum = "wrong";
    if (variant === "skipped") s.run.steps[0]!.status = "skipped";
    if (variant === "truncated") s.observations!.truncated = true;
    if (variant === "observation") s.observations!.events = [];
    if (variant === "role") s.observations!.role = "other";
    if (variant === "declarations") s.observations!.declarations = [];
    expect(toPlan(journey, checksum, s).diagnostics).toContain(
      "UNVERIFIED_RUN",
    );
  }
  const s = source();
  s.run.http[0]!.timeMs = 1;
  expect(toPlan(journey, checksum, s).diagnostics).toContain(
    "MISSING_RESPONSE_EVIDENCE",
  );
  const step = journey.steps[6]!;
  if (step.action !== "expectResponse") throw Error();
  s.run.http[0]!.timeMs = 15;
  s.run.http[0]!.url = "invalid";
  expect(responseProven(step, s)).toBe(false);
  s.run.http[0]!.url = "http://127.0.0.1/api/1";
  s.run.http.push({ ...s.run.http[0]! });
  expect(responseProven(step, s)).toBe(false);
  s.observations!.events[6]!.startedAtMs = undefined;
  expect(responseProven(step, s)).toBe(false);
});
it("marks definition-only sources and blocks private assertions without copying their data", () => {
  expect(toPlan(journey, checksum).diagnostics).toEqual(["DEFINITION_ONLY"]);
  const input = structuredClone(journey);
  input.steps.push({
    id: "private",
    action: "expectText",
    locator: { testId: "result" },
    text: "private-literal",
  });
  expect(toPlan(input, checksum).diagnostics).toContain("PRIVATE_DEFINITION");
  input.steps.at(-1)!.id = "email-assert";
  input.steps[input.steps.length - 1] = {
    id: "email-assert",
    action: "expectText",
    locator: { testId: "result" },
    text: "someone@example.test",
  };
  expect(toPlan(input, checksum).eligible).toBe(false);
});
it("rejects unknown actions, ambiguous locators, invalid IR versions and embedded values", () => {
  expect(
    journeySchema.safeParse({
      ...journey,
      steps: [{ id: "x", action: "select" }],
    }).success,
  ).toBe(false);
  expect(
    journeySchema.safeParse({
      ...journey,
      steps: [
        {
          id: "x",
          action: "click",
          locator: { role: "button", name: "Go", testId: "go" },
        },
      ],
    }).success,
  ).toBe(false);
  const plan = toPlan(journey, checksum);
  const verified = toPlan(journey, checksum, source());
  expect(
    planSchema.safeParse({
      ...verified,
      evidence: verified.evidence.map((e) => ({
        ...e,
        observationSeq: undefined,
      })),
    }).success,
  ).toBe(false);
  expect(planSchema.safeParse({ ...plan, diagnostics: [] }).success).toBe(
    false,
  );
  for (const input of [
    { ...plan, schemaVersion: 0 },
    { ...plan, evidence: [] },
    { ...plan, evidence: plan.evidence.slice().reverse() },
    {
      ...plan,
      journey: { ...plan.journey, steps: [plan.journey.steps[0]] },
      evidence: [plan.evidence[0]],
    },
    { ...plan, eligible: false },
    { ...plan, source: { ...plan.source, mode: "verified-run" } },
    { ...plan, journey },
    { ...plan, journey: { ...plan.journey, baseUrl: "http://127.0.0.1" } },
  ])
    expect(planSchema.safeParse(input).success).toBe(false);
});
it("bounds declarations and isolates roles without fixture state in the plan", () => {
  expect(
    journeySchema.safeParse({
      ...journey,
      steps: Array.from({ length: 101 }, (_, i) => ({
        ...journey.steps[0],
        id: `s${i}`,
      })),
    }).success,
  ).toBe(false);
  const other = { ...journey, role: "other" };
  const a = toPlan(journey, checksum),
    b = toPlan(other, "b".repeat(64));
  expect(a.journey.role).toBe("reviewer");
  expect(b.journey.role).toBe("other");
  expect(a.source.flowId).not.toBe(b.source.flowId);
});

it("allocates distinct stable input bindings despite normalized ID and explicit-env name collisions", () => {
  const input = structuredClone(journey);
  input.steps = [
    {
      id: "first",
      action: "fill",
      locator: { testId: "first" },
      value: "synthetic-one",
    },
    {
      id: "FIRST",
      action: "fill",
      locator: { testId: "upper" },
      value: "synthetic-two",
    },
    {
      id: "explicit",
      action: "fill",
      locator: { testId: "explicit" },
      valueFromEnv: "JP_INPUT_AAAAAAAA_0_FIRST",
    },
    journey.steps.at(-1)!,
  ];
  const plan = toPlan(input, checksum);
  const bindings = plan.journey.steps.flatMap((s) =>
    s.action === "fill" ? [s.valueFromEnv] : [],
  );
  expect(new Set(bindings).size).toBe(3);
  expect(bindings[0]).toBe("JP_INPUT_AAAAAAAA_0_FIRST_1");
  expect(bindings[2]).toBe("JP_INPUT_AAAAAAAA_0_FIRST");
  for (const value of ["", "ab", "passed"]) {
    input.steps[0] = {
      id: "first",
      action: "fill",
      locator: { testId: "first" },
      value,
    };
    expect(toPlan(input, checksum).diagnostics).toContain("UNSUPPORTED_INPUT");
  }
});
