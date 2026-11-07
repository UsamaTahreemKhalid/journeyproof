import { chromium, type Browser, type BrowserContext } from "playwright";
import { randomBytes } from "node:crypto";
import { rm, chmod } from "node:fs/promises";
import { join, relative, resolve, isAbsolute } from "node:path";
import type { Journey } from "../config/schema.js";
import { journeySchema } from "../config/schema.js";
import { resolveValues } from "../config/load.js";
import { baseOrigin, redact, redactObject, safeUrl } from "../shared/safety.js";
import { InputError, errorText } from "../shared/errors.js";
import type { RunResult } from "../shared/types.js";
import {
  DEFAULT_OUTPUT,
  privateDirectory,
  runDirectory,
  writePrivate,
} from "../evidence/store.js";
import { readSanitizedTrace } from "../evidence/trace.js";
import { writeReport } from "../report/write.js";
import { executeStep, expected, locate, type StepExecutor } from "./steps.js";
import { ObservationCapture } from "../observations/capture.js";
import { observationsSchema } from "../observations/schema.js";
import { guardRedirects } from "./origin-guard.js";
import { sourceLinkSchema } from "../regression/model.js";
import { VERSION } from "../shared/version.js";

export interface RunOptions {
  journey: Journey;
  source: { file: string; checksum: string };
  flowPath?: string;
  workspaceRoot?: string;
  stepExecutor?: StepExecutor;
  baseUrl?: string;
  outputDir?: string;
  timeoutMs?: number;
  runTimeoutMs?: number;
  headed?: boolean;
  allowRemote?: boolean;
  guardRedirectOrigins?: boolean;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}
export async function runJourney(options: RunOptions) {
  const journey = journeySchema.parse(options.journey);
  const { values, secrets } = resolveValues(
    journey,
    options.env ?? process.env,
  );
  const origin = baseOrigin(
    options.baseUrl ?? journey.baseUrl ?? "http://127.0.0.1:4173",
    options.allowRemote,
  );
  const timeout = options.timeoutMs ?? 5000;
  const runTimeout = options.runTimeoutMs ?? 300000;
  if (
    !Number.isInteger(timeout) ||
    timeout < 100 ||
    timeout > 30000 ||
    !Number.isInteger(runTimeout) ||
    runTimeout < 100 ||
    runTimeout > 300000
  )
    throw new InputError(
      "Timeouts must be 100–30000 ms per step and 100–300000 ms per run",
    );
  const started = Date.now();
  const id = `${started}-${randomBytes(4).toString("hex")}`;
  const root = await privateDirectory(options.outputDir ?? DEFAULT_OUTPUT);
  const dir = await runDirectory(root, id, true);
  const run: RunResult = {
    schemaVersion: 1,
    id,
    name: journey.name,
    status: "passed",
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    metadata: {
      toolVersion: VERSION,
      nodeVersion: process.version,
      hostname: new URL(origin).hostname,
      flowFile: options.source.file,
      checksum: options.source.checksum,
    },
    reproduction: `journeyproof run --flow ${shellQuote(options.flowPath ?? options.source.file)} --base-url ${shellQuote(origin)}${options.allowRemote ? " --allow-remote" : ""}`,
    steps: journey.steps.map((s) => ({
      id: s.id,
      action: s.action,
      status: "skipped",
      durationMs: 0,
      expected: expected(s),
      observed: "Not executed",
    })),
    http: [],
    errors: [],
    warnings: [],
  };
  const capture = new ObservationCapture(
    journey,
    id,
    origin,
    [...secrets, ...Object.values(values)],
    started,
  );
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let tracing = false;
  const popupCaptures: Promise<void>[] = [];
  let interrupted = options.signal?.aborted ?? false;
  const abort = () => {
    interrupted = true;
    void context?.close().catch(() => {});
  };
  const timer = setTimeout(abort, runTimeout);
  options.signal?.addEventListener("abort", abort, { once: true });
  const clean = (s: string) => redact(s, secrets).slice(0, 3000);
  try {
    browser = await chromium.launch({
      headless: !options.headed,
      timeout: Math.min(timeout, 10000),
    });
    run.metadata.browserVersion = browser.version();
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      timezoneId: "UTC",
      locale: "en-US",
      acceptDownloads: false,
      serviceWorkers: "block",
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort("blockedbyclient"),
    );
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.tracing.start({
      screenshots: false,
      snapshots: false,
      sources: false,
    });
    tracing = true;
    const page = await context.newPage();
    if (options.guardRedirectOrigins) await guardRedirects(page, origin);
    capture.attach(page);
    let popupCount = 1;
    let navigationViolation = false;
    page.on("framenavigated", (frame) => {
      if (
        frame === page.mainFrame() &&
        new URL(frame.url()).origin !== origin
      ) {
        navigationViolation = true;
        void page.close().catch(() => {});
      }
    });
    context.on("page", (extra) => {
      if (extra !== page) {
        const observation = capture.popup(
          `page-${Math.min(++popupCount, 9999)}`,
          extra.url(),
        );
        if (observation)
          popupCaptures.push(
            extra
              .opener()
              .then((opener) => {
                if (opener === page) observation.openerPageId = "page-1";
              })
              .catch(() => {
                /* An unavailable opener remains explicitly unknown. */
              }),
          );
        void extra.close().catch(() => {});
        if (run.warnings.length < 100)
          run.warnings.push("Additional page blocked (one-page limit)");
      }
    });
    page.on("download", (download) => {
      void download.cancel();
    });
    page.on("response", (response) => {
      if (run.http.length < 200 && new URL(response.url()).origin === origin)
        run.http.push({
          method: response.request().method(),
          url: clean(safeUrl(response.url())),
          status: response.status(),
          timeMs: Date.now() - started,
        });
    });
    page.on("pageerror", (error) => {
      if (run.errors.length < 100) run.errors.push(clean(error.message));
    });
    page.on("console", (msg) => {
      if (msg.type() === "error" && run.errors.length < 100)
        run.errors.push(clean(msg.text()));
    });
    for (let i = 0; i < journey.steps.length; i++) {
      const step = journey.steps[i]!;
      const result = run.steps[i]!;
      const stepStart = Date.now();
      capture.begin(page, step.id);
      try {
        if (interrupted)
          throw new Error("Run interrupted or run timeout exceeded");
        const remaining = runTimeout - (Date.now() - started);
        if (remaining < 1) throw new Error("Run timeout exceeded");
        result.observed = await (options.stepExecutor ?? executeStep)(
          page,
          step,
          origin,
          values[step.id],
          Math.max(1, Math.min(step.timeoutMs ?? timeout, remaining)),
        );
        if (navigationViolation)
          throw new Error(
            "Navigation outside the configured origin was blocked",
          );
        result.status = "passed";
      } catch (stepError) {
        run.status = "failed";
        result.status = "failed";
        result.reason = clean(
          interrupted
            ? "Run interrupted or run timeout exceeded"
            : navigationViolation
              ? "Navigation outside the configured origin was blocked"
              : errorText(stepError),
        );
        result.observed = result.reason;
        try {
          const masks = [
            page.locator("input, textarea, [contenteditable]"),
            ...journey.steps
              .filter((s) => s.action === "fill" && s.valueFromEnv)
              .map((s) =>
                locate(
                  page,
                  (s as Extract<typeof s, { action: "fill" }>).locator,
                ),
              ),
            ...Object.values(values)
              .filter(Boolean)
              .map((secret) => page.getByText(secret, { exact: false })),
          ];
          const screenshot = await page.screenshot({
            mask: masks,
            timeout: Math.min(timeout, 3000),
            animations: "disabled",
          });
          if (screenshot.byteLength > 4 * 1024 * 1024)
            throw new Error("Screenshot exceeds 4 MiB limit", {
              cause: stepError,
            });
          await writePrivate(join(dir, "failure.png"), screenshot);
          result.screenshot = "failure.png";
        } catch {
          run.warnings.push("Failure screenshot unavailable");
        }
        break;
      } finally {
        result.durationMs = Date.now() - stepStart;
        await capture.end(page, result);
      }
    }
  } catch (error) {
    run.status = "error";
    if (run.errors.length < 100) run.errors.push(clean(errorText(error)));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    const rawPath = join(dir, ".raw-trace.zip");
    if (context && tracing) {
      try {
        await context.tracing.stop({ path: rawPath });
        await chmod(rawPath, 0o600);
        await writePrivate(
          join(dir, "trace.zip"),
          await readSanitizedTrace(rawPath, [
            ...secrets,
            ...Object.values(values),
          ]),
        );
        run.trace = "trace.zip";
      } catch {
        run.warnings.push("Browser trace unavailable");
      } finally {
        await rm(rawPath, { force: true });
      }
    }
    await browser?.close().catch(() => {
      run.warnings.push("Browser cleanup reported an error");
    });
  }
  await Promise.all(popupCaptures);
  run.durationMs = Date.now() - started;
  run.warnings = run.warnings.slice(0, 100);
  // Redact the entire structured result, including hostile flow names/locators.
  const sanitized = redactObject(run, secrets);
  try {
    await writePrivate(
      join(dir, "observations.json"),
      JSON.stringify(observationsSchema.parse(capture.document), null, 2) +
        "\n",
    );
  } catch {
    sanitized.warnings.push("Workflow observations unavailable");
  }
  if (options.flowPath) {
    const flowPath = relative(
      resolve(options.workspaceRoot ?? process.cwd()),
      resolve(options.workspaceRoot ?? process.cwd(), options.flowPath),
    )
      .split("\\")
      .join("/");
    const link = sourceLinkSchema.safeParse({
      schemaVersion: 1,
      flowPath,
      checksum: options.source.checksum,
    });
    if (link.success && !isAbsolute(flowPath) && !flowPath.startsWith(".."))
      await writePrivate(
        join(dir, "source.json"),
        JSON.stringify(link.data) + "\n",
      );
  }
  const paths = await writeReport(dir, sanitized);
  return { run: sanitized, paths };
}
function shellQuote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
