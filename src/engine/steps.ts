import type { Locator, Page } from "playwright";
import type { LocatorSpec, Step } from "../config/schema.js";
import { pathMatches } from "../shared/safety.js";

export type StepExecutor = (
  page: Page,
  step: Step,
  origin: string,
  value: string | undefined,
  timeout: number,
) => Promise<string>;

export function locate(page: Page, spec: LocatorSpec): Locator {
  if ("testId" in spec) return page.getByTestId(spec.testId);
  // Password controls have no implicit textbox role in ARIA.
  if (spec.role === "textbox")
    return page.getByLabel(spec.name, { exact: true });
  return page.getByRole(spec.role, { name: spec.name, exact: true });
}
export function expected(step: Step): string {
  switch (step.action) {
    case "goto":
      return `Navigate to ${step.path}`;
    case "fill":
      return "Fill the named field (value withheld)";
    case "click":
      return "Click the named control";
    case "expectVisible":
      return "Named element is visible";
    case "expectText":
      return `Visible text ${step.contains ? "contains" : "equals"}: ${step.text}`;
    case "expectUrl":
      return `URL pathname matches ${step.path}`;
    case "expectResponse":
      return `${step.method} ${step.path} returns HTTP ${step.status}`;
  }
}
export async function executeStep(
  page: Page,
  step: Step,
  origin: string,
  value: string | undefined,
  timeout: number,
): Promise<string> {
  switch (step.action) {
    case "goto": {
      const response = await page.goto(origin + step.path, {
        timeout,
        waitUntil: "domcontentloaded",
      });
      if (response && response.status() >= 400)
        throw new Error(`Navigation returned HTTP ${response.status()}`);
      return `Navigated to ${step.path}`;
    }
    case "fill":
      await locate(page, step.locator).fill(value!, { timeout });
      return "Field filled (value withheld)";
    case "click":
      await locate(page, step.locator).click({ timeout });
      return "Control clicked";
    case "expectVisible":
      await locate(page, step.locator).waitFor({ state: "visible", timeout });
      return "Element is visible";
    case "expectText": {
      const locator = locate(page, step.locator);
      await locator.waitFor({ state: "visible", timeout });
      await poll(
        async () => {
          const text = (await locator.innerText({ timeout }))
            .replace(/\s+/g, " ")
            .trim();
          return step.contains ? text.includes(step.text) : text === step.text;
        },
        timeout,
        "Text assertion did not match expected text",
      );
      return "Visible text matched";
    }
    case "expectUrl":
      await page.waitForURL(
        (url) => url.origin === origin && pathMatches(step.path, url.pathname),
        { timeout },
      );
      return `URL pathname matched ${step.path}`;
    case "expectResponse": {
      // Attach both handlers immediately so rejected click/wait promises never leak.
      const [response] = await Promise.all([
        page.waitForResponse(
          (response) => {
            const url = new URL(response.url());
            return (
              url.origin === origin &&
              pathMatches(step.path, url.pathname) &&
              response.request().method() === step.method
            );
          },
          { timeout },
        ),
        locate(page, step.locator).click({ timeout }),
      ]);
      if (response.status() !== step.status)
        throw new Error(
          `Expected HTTP ${step.status}; observed HTTP ${response.status()} for ${step.method} ${step.path}`,
        );
      return `Observed HTTP ${response.status()} for ${step.method} ${step.path}`;
    }
  }
}
async function poll(
  check: () => Promise<boolean>,
  timeout: number,
  message: string,
) {
  const end = Date.now() + timeout;
  do {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  } while (Date.now() < end);
  throw new Error(message);
}
