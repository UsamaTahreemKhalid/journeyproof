import { it, expect } from "vitest";
import { renderReport } from "../../src/report/render.js";
import { sampleRun } from "../helpers.js";
it("escapes untrusted report data and embeds no scripts or external resources", () => {
  const run = sampleRun();
  run.name = "<img src=x onerror=alert(1)>";
  run.errors = ["<script>alert(1)</script>"];
  run.reproduction = "<script>bad</script>";
  const html = renderReport(run);
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<img");
  expect(html).toContain("default-src 'none'");
  expect(html).not.toMatch(/(?:src|href)="https?:/);
  expect(html).toContain("Not captured");
});
it("only links actual fixed-name artifacts and displays precise failures", () => {
  const run = sampleRun();
  run.status = "failed";
  run.trace = "trace.zip";
  run.steps[0] = {
    ...run.steps[0]!,
    status: "failed",
    reason: "HTTP 500",
    screenshot: "failure.png",
  };
  run.http.push({
    method: "POST",
    url: "http://127.0.0.1/api",
    status: 500,
    timeMs: 20,
  });
  const html = renderReport(run, new Set(["failure.png", "trace.zip"]));
  expect(html).toContain('href="failure.png"');
  expect(html).toContain('href="trace.zip"');
  expect(html).toContain("HTTP 500");
  expect(html).toContain("FAIL");
  run.status = "error";
  expect(renderReport(run)).toContain("TOOL ERROR");
  expect(renderReport(run)).not.toContain('href="trace.zip"');
});
