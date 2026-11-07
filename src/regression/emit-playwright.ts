import { format } from "prettier";
import type { LocatorSpec, Step } from "../config/schema.js";
import { planSchema, type RegressionPlan } from "./model.js";
// JSON literals only, including explicit escaping of script delimiters and line separators.
export const literal = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
function locator(spec: LocatorSpec) {
  return "testId" in spec
    ? `page.getByTestId(${literal(spec.testId)})`
    : spec.role === "textbox"
      ? `page.getByLabel(${literal(spec.name)}, { exact: true })`
      : `page.getByRole(${literal(spec.role)}, { name: ${literal(spec.name)}, exact: true })`;
}
const textMatcher = `function matchesText(element: Element, expected: { text: string; contains: boolean }): boolean {
        const normalize = (text: string) => text.replace(/[\\u200b\\u00ad]/g, "").trim().replace(/\\s+/g, " ");
        const readText = (node: Node): string => {
          if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
          if (node instanceof Element) {
            if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(node.tagName) || node.ownerDocument.head?.contains(node)) return "";
            if (node instanceof HTMLInputElement && ["button", "submit"].includes(node.type)) return node.value;
          }
          const text = Array.from(node.childNodes, readText).join("");
          return node instanceof Element && node.shadowRoot ? text + readText(node.shadowRoot) : text;
        };
        const actual = normalize(readText(element));
        const wanted = normalize(expected.text);
        return expected.contains ? actual.includes(wanted) : actual === wanted;

}`;
function action(step: Step): string {
  const target = "locator" in step ? locator(step.locator) : "";
  switch (step.action) {
    case "goto":
      return `const response = await page.goto(origin + ${literal(step.path)}, { waitUntil: "domcontentloaded", timeout }); if (response && response.status() >= 400) throw new Error("Navigation returned HTTP " + response.status()); await expect(page.locator("body")).toBeVisible({ timeout });`;
    case "fill":
      return `await ${target}.fill(value!, { timeout });`;
    case "click":
      return `await ${target}.click({ timeout });`;
    case "expectVisible":
      return `await expect(${target}).toBeVisible({ timeout });`;
    case "expectText":
      // Compare in the browser and expose only a boolean to the matcher.
      // A caught locator assertion can already have recorded its received text
      // in Playwright reporter events before our sanitized error is thrown.
      return `await expect.poll(() => ${target}.evaluate(matchesText, { text: ${literal(step.text)}, contains: ${Boolean(step.contains)} }, { timeout }), { timeout }).toBe(true);`;
    case "expectUrl":
      return `await expect.poll(() => { const url = new URL(page.url()); return url.origin === origin && pathMatches(${literal(step.path)}, url.pathname); }, { timeout }).toBe(true);`;
    case "expectResponse":
      return `const [response] = await Promise.all([page.waitForResponse(r => { const url = new URL(r.url()); return url.origin === origin && r.request().method() === ${literal(step.method)} && pathMatches(${literal(step.path)}, url.pathname); }, { timeout }), ${target}.click({ timeout })]); if (response.status() !== ${step.status}) throw new Error("Expected HTTP ${step.status}; observed HTTP " + response.status() + ${literal(` for ${step.method} ${step.path}`)}); await expect(response.status()).toBe(${step.status});`;
  }
}
export async function emitPlaywright(input: RegressionPlan) {
  const plan = planSchema.parse(input);
  if (!plan.eligible) throw new Error("Plan is not eligible");
  const code = `// JourneyProof generator v1; ${plan.source.flowId}; ${plan.source.runId ?? "DEFINITION ONLY - not executed"}
// Regenerate: journeyproof generate-test ${plan.source.runId ? "--run " + plan.source.runId : "--flow APPROVED_FLOW.yaml"} --dry-run
// Review before execution. Required inputs are named in the plan; no fallback values.
import { test, expect } from "@playwright/test";
import { runRegression, pathMatches } from "journeyproof/testing";
const plan = ${literal(plan)} as const;
${plan.journey.steps.some((step) => step.action === "expectText") ? textMatcher : ""}
test.use({ trace: "off", screenshot: "off", video: "off" });
test(${literal(plan.source.flowId)}, async ({ browserName }, testInfo) => {
  void browserName;
  testInfo.setTimeout(60000);
  const result = await runRegression(plan, async (page, step, origin, value, timeout) => {
    await test.step(step.id, async () => {
      let failure: string | undefined;
      try { switch (step.id) {
${plan.journey.steps.map((s) => `case ${literal(s.id)}: { ${action(s)} break; }`).join("\n")}
        default: throw new Error("Generated step ID mismatch");
      } } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const status = /^Expected HTTP ([0-9]{3}); observed HTTP ([0-9]{3})/.exec(message);
        failure = status ? "Expected HTTP " + status[1] + "; observed HTTP " + status[2] : "Configured " + step.action + " failed";
      }
      if (failure) throw new Error(failure);
    });
    return "Configured operation completed";
  });
  await testInfo.attach("journeyproof-evidence", { body: JSON.stringify({ runId: result.run.id, paths: result.paths }), contentType: "application/json" });
  expect(result.run.status, "JourneyProof run " + result.run.id + "; inspect its local report").toBe("passed");
});`;
  return format(code, { parser: "typescript" });
}
