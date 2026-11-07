import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createDemo } from "../../examples/admissions-demo/app/server.mjs";
const execute = promisify(execFile),
  root = resolve(".journeyproof/viewer-e2e"),
  screenshots = resolve(".journeyproof/map-demo/screenshots");
let manifest: {
  healthy: string;
  broken: string;
  mapId: string;
  html: string;
  json: string;
};
async function cli(args: string[], code = 0) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    JOURNEY_DEMO_EMAIL: "officer@example.test",
    JOURNEY_DEMO_PASSWORD: "fictional-demo-password",
  };
  delete env.FORCE_COLOR;
  try {
    const r = await execute(process.execPath, ["dist/cli.js", ...args], {
      env,
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(code).toBe(0);
    return JSON.parse(r.stdout);
  } catch (error) {
    const e = error as { code?: number; stdout?: string };
    if (code === 1 && e.code === 1) return JSON.parse(e.stdout!);
    throw error;
  }
}
test.beforeAll(async () => {
  const ids: string[] = [];
  for (const broken of [false, true]) {
    const app = createDemo({ failApproval: broken });
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const addr = app.address();
    if (!addr || typeof addr === "string") throw Error("No port");
    try {
      const r = await cli(
        [
          "run",
          "--flow",
          "examples/admissions-demo/journeys/happy-path.yaml",
          "--base-url",
          `http://127.0.0.1:${addr.port}`,
          "--output-dir",
          root,
          "--json",
        ],
        broken ? 1 : 0,
      );
      ids.push(r.run.id);
    } finally {
      await new Promise<void>((r) => app.close(() => r()));
    }
  }
  const built = await cli([
    "map",
    "--compare",
    ...ids,
    "--output-dir",
    root,
    "--json",
  ]);
  expect(built.firstDivergence).toBe("approve-admission");
  manifest = {
    healthy: ids[0]!,
    broken: ids[1]!,
    mapId: built.mapId,
    html: resolve(built.paths.html),
    json: resolve(built.paths.json),
  };
  await mkdir(screenshots, { recursive: true });
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
});
test("offline production graph supports comparison, filters, zoom, keyboard and actual evidence", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (req) => {
    if (/^https?:/.test(req.url())) external.push(req.url());
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(pathToFileURL(manifest.html).href);
  await expect(page.locator("#nodes button")).toHaveCount(20);
  await expect(page.locator("#divergence")).toContainText("approve admission");
  await expect(page.locator("#links-count")).toHaveText("1");
  await page.screenshot({
    path: join(screenshots, "desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Inspect divergence" }).click();
  await expect(page.locator("#detail-content")).toContainText(
    "Expected HTTP 200; observed HTTP 500.",
  );
  await page.getByRole("button", { name: "Preview screenshot" }).click();
  await expect(page.locator("#detail-content img")).toHaveJSProperty(
    "complete",
    true,
  );
  expect(
    await page
      .locator("#detail-content img")
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await page.screenshot({
    path: join(screenshots, "divergence.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).toBeHidden();
  await page.getByLabel("Run", { exact: true }).selectOption(manifest.broken);
  await page
    .getByLabel("State", { exact: true })
    .selectOption("declared_unreached");
  await expect(page.locator("#nodes button")).toHaveCount(1);
  await expect(page.locator("#nodes button")).toContainText("check approved");
  await page.getByRole("button", { name: "Reset filters" }).click();
  await page.getByLabel("Search", { exact: true }).fill("approve");
  await expect(page.locator("#nodes button")).toHaveCount(3);
  await expect(page.locator("#nodes button.action")).toHaveCount(2);
  await expect(page.locator("#nodes button.page")).toHaveCount(1);
  await page.getByRole("button", { name: "Reset filters" }).click();
  await page
    .getByLabel("Role", { exact: true })
    .selectOption("admissions-officer");
  await expect(page.locator("#nodes button")).toHaveCount(20);
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  const before = await page.locator("#nodes button").first().boundingBox();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const after = await page.locator("#nodes button").first().boundingBox();
  expect(after!.width).toBeGreaterThan(before!.width);
  await page.getByRole("button", { name: "Fit to view", exact: true }).click();
  await page.locator("#nodes button").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#details")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("#edges .transition").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#detail-content h2")).toContainText("transition");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Toggle light or dark theme" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: join(screenshots, "light.png"),
    fullPage: true,
  });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
test("mobile uses an accessible list, preserves focus and has no horizontal page overflow", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(pathToFileURL(manifest.html).href);
    await expect(page.locator("#graph-area")).toHaveAttribute(
      "data-view",
      "list",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: join(screenshots, "mobile.png"),
      fullPage: true,
    });
    await page.locator("#node-list button").first().tap();
    await expect(page.locator("#details")).toBeVisible();
    await page.getByRole("button", { name: "Close evidence details" }).tap();
    await page.getByRole("button", { name: "Show graph", exact: true }).tap();
    await expect(page.locator("#graph-area")).toHaveAttribute(
      "data-view",
      "graph",
    );
  } finally {
    await context.close();
  }
});
test("malformed data, injection attempts and absent screenshot files fail safely", async ({
  page,
}) => {
  const original = await readFile(manifest.html, "utf8");
  const data = JSON.parse(await readFile(manifest.json, "utf8"));
  data.nodes[0].title = '<img src=x onerror="globalThis.pwned=true">';
  data.flows[0].name = "</script><script>globalThis.pwned=true</script>";
  const serialized = JSON.stringify(data).replace(/</g, "\\u003c");
  const injected = original.replace(
    /(<script id="map-data" type="application\/json">)[\s\S]*?(<\/script>)/,
    (_, start, end) => start + serialized + end,
  );
  const file = join(dirname(manifest.html), "injection-test.html");
  await writeFile(file, injected);
  await page.goto(pathToFileURL(file).href);
  await expect(page.locator("#flow-name")).toContainText("<script>");
  expect(
    await page.evaluate(() => (globalThis as { pwned?: boolean }).pwned),
  ).toBeUndefined();
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "globalThis.pwned=true";
    document.body.append(script);
  });
  expect(
    await page.evaluate(() => (globalThis as { pwned?: boolean }).pwned),
  ).toBeUndefined();
  await writeFile(
    file,
    original.replace(
      /(<script id="map-data" type="application\/json">)[\s\S]*?(<\/script>)/,
      "$1{bad-json$2",
    ),
  );
  await page.goto(pathToFileURL(file).href);
  await expect(page.locator("#flow-name")).toHaveText(
    "Map could not be loaded",
  );
  const png = join(
      dirname(manifest.html),
      "evidence",
      manifest.broken,
      "failure.png",
    ),
    bytes = await readFile(png);
  await rm(png);
  try {
    await page.goto(pathToFileURL(manifest.html).href);
    await page.getByRole("button", { name: "Inspect divergence" }).click();
    await page.getByRole("button", { name: "Preview screenshot" }).click();
    await expect(page.locator("#detail-content")).toContainText(
      "Screenshot file is unavailable",
    );
  } finally {
    await writeFile(png, bytes);
    await rm(file);
  }
});
