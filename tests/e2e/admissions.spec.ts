import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { createDemo } from "../../examples/admissions-demo/app/server.mjs";

const flow = "examples/admissions-demo/journeys/happy-path.yaml";
const env: NodeJS.ProcessEnv & {
  JOURNEY_DEMO_EMAIL: string;
  JOURNEY_DEMO_PASSWORD: string;
} = {
  ...process.env,
  JOURNEY_DEMO_EMAIL: "officer@example.test",
  JOURNEY_DEMO_PASSWORD: "fictional-demo-password",
};
delete env.FORCE_COLOR;
async function cli(args: string[]) {
  const child = spawn(process.execPath, ["dist/cli.js", ...args], { env });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const [code] = await once(child, "exit");
  return { code, stdout, stderr };
}
for (const broken of [false, true])
  test(`actual CLI admissions journey: ${broken ? "HTTP 500 approval" : "healthy"}`, async ({
    browser,
  }) => {
    const app = createDemo({ failApproval: broken });
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    if (!address || typeof address === "string") throw Error("No address");
    const output = resolve(".journeyproof/runs");
    try {
      const result = await cli([
        "run",
        "--flow",
        flow,
        "--base-url",
        `http://127.0.0.1:${address.port}`,
        "--output-dir",
        output,
        "--json",
      ]);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(broken ? 1 : 0);
      const data = JSON.parse(result.stdout);
      const run = data.run;
      expect(run.status).toBe(broken ? "failed" : "passed");
      const dir = join(output, run.id);
      const json = await readFile(join(dir, "run.json"), "utf8");
      const html = await readFile(join(dir, "index.html"), "utf8");
      for (const secret of [
        env.JOURNEY_DEMO_EMAIL,
        env.JOURNEY_DEMO_PASSWORD,
      ]) {
        expect(json).not.toContain(secret);
        expect(html).not.toContain(secret);
      }
      expect(run.trace).toBe("trace.zip");
      expect((await stat(join(dir, "trace.zip"))).size).toBeGreaterThan(100);
      const trace = unzipSync(await readFile(join(dir, "trace.zip")));
      for (const [name, bytes] of Object.entries(trace)) {
        expect(name).not.toContain("resources/");
        const text = strFromU8(bytes);
        expect(text).not.toContain(env.JOURNEY_DEMO_PASSWORD);
        expect(text).not.toContain("postData");
        expect(text).not.toContain("demo_session=");
      }
      expect(run.steps).toHaveLength(15);
      if (broken) {
        const failed = run.steps.filter(
          (s: { status: string }) => s.status === "failed",
        );
        expect(failed).toHaveLength(1);
        expect(failed[0].id).toBe("approve-admission");
        expect(failed[0].reason).toContain("observed HTTP 500");
        expect(run.steps.at(-1).status).toBe("skipped");
        expect(
          run.http.some(
            (h: { method: string; status: number; url: string }) =>
              h.method === "POST" &&
              h.status === 500 &&
              h.url.endsWith("/approve"),
          ),
        ).toBe(true);
        expect(
          (await readFile(join(dir, "failure.png"))).subarray(1, 4).toString(),
        ).toBe("PNG");
      } else {
        expect(
          run.steps.every((s: { status: string }) => s.status === "passed"),
        ).toBe(true);
      }
      const page = await browser.newPage();
      await page.goto("file://" + join(dir, "index.html"));
      await expect(
        page.getByRole("heading", { name: "admission-approval", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(broken ? "FAIL" : "PASS", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Sanitized browser trace" }),
      ).toHaveAttribute("href", "trace.zip");
      const demo = resolve(
        ".journeyproof/verified-demo",
        broken ? "broken" : "healthy",
      );
      await mkdir(demo, { recursive: true });
      await writeFile(
        join(demo, "latest.json"),
        JSON.stringify({ id: run.id, dir }),
      );
      await page.screenshot({ path: join(demo, "report.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: "dark" });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .locator("body")
          .evaluate((body) => getComputedStyle(body).backgroundColor),
      ).toBe("rgb(16, 23, 34)");
      await page.screenshot({
        path: join(demo, "report-dark-mobile.png"),
        fullPage: true,
      });
      await page.close();
      expect(
        (await cli(["report", "--run", run.id, "--output-dir", output])).code,
      ).toBe(0);
    } finally {
      await new Promise<void>((r) => app.close(() => r()));
    }
  });
test("invalid flow and traversal are input errors with structured output", async () => {
  const missing = await cli(["run", "--flow", "missing.yaml", "--json"]);
  expect(missing.code).toBe(2);
  expect(JSON.parse(missing.stdout).status).toBe("error");
  const traversal = await cli(["report", "--run", "../../etc"]);
  expect(traversal.code).toBe(2);
  expect(traversal.stderr).toContain("Invalid run ID");
});
