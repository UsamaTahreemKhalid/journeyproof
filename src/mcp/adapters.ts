import { securityMessage } from "../engine/origin-guard.js";
import { join } from "node:path";
import { lstat } from "node:fs/promises";
import type { RunResult } from "../shared/types.js";
import { summarize } from "../shared/types.js";
import { summarySchema } from "./schemas.js";
import type { WorkspacePolicy } from "./policy.js";

export async function summarizeReport(
  run: RunResult,
  dir: string,
  policy: WorkspacePolicy,
  maxEvents = 20,
) {
  const failed = run.steps.find((s) => s.status === "failed");
  // Do not relay page text, console messages, locators, flow names or browser errors to the model.
  const token = (value: string) =>
    /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : "untrusted";
  const mismatch = failed?.reason?.match(
    /^Expected HTTP ([1-5][0-9]{2}); observed HTTP ([1-5][0-9]{2}) for (?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/[a-zA-Z0-9/_.\-*]*$/,
  );
  const reason = run.security
    ? securityMessage(run.security.code)
    : mismatch
      ? `Expected HTTP ${mismatch[1]}; observed HTTP ${mismatch[2]}.`
      : "Step assertion or browser operation failed; inspect the local report for details.";
  const events = run.http.filter((event) => event.status >= 400);
  const evidence = [];
  for (const [kind, filename] of [
    ["json", "run.json"],
    ["html", "index.html"],
    ["screenshot", "failure.png"],
    ["trace", "trace.zip"],
  ] as const) {
    let available = false;
    try {
      available = (await lstat(join(dir, filename))).isFile();
    } catch {
      /* Missing evidence is explicit. */
    }
    evidence.push({
      kind,
      path: policy.location(join(dir, filename)),
      available,
    });
  }
  const http = events.slice(0, maxEvents).map((event) => {
    let path = "[omitted]";
    try {
      const pathname = new URL(event.url).pathname;
      if (/^\/[a-zA-Z0-9/_.-]{0,200}$/.test(pathname)) path = pathname;
    } catch {
      /* Untrusted persisted URL. */
    }
    return {
      method: [
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "HEAD",
        "OPTIONS",
      ].includes(event.method)
        ? event.method
        : "OTHER",
      path,
      status: event.status,
    };
  });
  const summary = summarySchema.parse({
    runId: run.id,
    status: run.status,
    counts: summarize(run),
    durationMs: run.durationMs,
    steps: run.steps.map((step) => ({
      id: token(step.id),
      action: token(step.action),
      status: step.status,
    })),
    ...(failed ? { failure: { stepId: token(failed.id), reason } } : {}),
    http,
    evidence,
    truncated: events.length > maxEvents,
    untrustedData: true,
  });
  while (Buffer.byteLength(JSON.stringify(summary)) > 22000) {
    summary.truncated = true;
    if (summary.http.length) summary.http.pop();
    else summary.steps.pop();
  }
  return summary;
}
