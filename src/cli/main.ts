import { WorkspacePolicy, PolicyError } from "../mcp/policy.js";
import { RegressionService } from "../regression/service.js";
import { workflowCoverage, coverageTable } from "../regression/coverage.js";
import { relative, basename } from "node:path";
import { MapService } from "../map/service.js";
import { parseArgs, HELP, COMMAND_HELP } from "./args.js";
import { init, doctor, openReport } from "./commands.js";
import { loadJourney } from "../config/load.js";
import { runJourney } from "../engine/run.js";
import { regenerateReport } from "../report/write.js";
import { DEFAULT_OUTPUT } from "../evidence/store.js";
import { exitCode, InputError } from "../shared/errors.js";
import { VERSION } from "../shared/version.js";

export interface IO {
  out: (message: string) => void;
  err: (message: string) => void;
}
export async function main(
  args: string[],
  io: IO = { out: (s) => console.log(s), err: (s) => console.error(s) },
  signal?: AbortSignal,
): Promise<number> {
  const json = args.includes("--json");
  try {
    const { command, flags: f } = parseArgs(args);
    const output = String(f["output-dir"] ?? DEFAULT_OUTPUT);
    const emit = (data: unknown, human: string) =>
      io.out(json ? JSON.stringify(data) : human);
    if (command === "mcp") {
      const { startStdio } = await import("../mcp/stdio.js");
      await startStdio(signal);
      return 0;
    }
    if (command === "help") {
      io.out(f.topic ? HELP + "\n" + COMMAND_HELP[String(f.topic)] : HELP);
      return 0;
    }
    if (command === "version") {
      io.out(VERSION);
      return 0;
    }
    if (command === "init") {
      const file = await init(String(f.dir ?? "."), Boolean(f.force));
      io.out(
        `Created ${file}\nNext: start your app; journeyproof doctor --flow ${file}; journeyproof run --flow ${file}`,
      );
      return 0;
    }
    if (command === "doctor") {
      const result = await doctor(
        output,
        f.flow ? String(f.flow) : undefined,
        !f["no-browser"],
      );
      emit(
        result,
        result.checks
          .map((c) => `${c.ok ? "OK" : "FAIL"} ${c.name}: ${c.detail}`)
          .join("\n"),
      );
      return result.ok ? 0 : 2;
    }
    if (command === "map") {
      const result = await new MapService(output).build(
        f.compare ? String(f.compare).split(",") : [String(f.run)],
        f.role ? String(f.role) : undefined,
        signal,
      );
      const metadata = {
        status: "ok",
        mapId: result.map.mapId,
        sourceRunIds: result.map.sourceRunIds,
        summary: result.map.summary,
        firstDivergence: result.map.comparison?.firstDivergence,
        paths: {
          json: relative(process.cwd(), result.paths.json),
          html: relative(process.cwd(), result.paths.html),
        },
      };
      emit(
        metadata,
        `MAP ${metadata.mapId} · built\nSources: ${metadata.sourceRunIds.join(", ")}\nJSON: ${metadata.paths.json}\nHTML: ${metadata.paths.html}\nOpen: journeyproof map ${f.compare ? "--compare " + String(f.compare).replace(",", " ") : "--run " + String(f.run)} --open`,
      );
      if (f.open && !(await openReport(result.paths.html)))
        io.err("Could not open browser. Open the HTML path manually.");
      return 0;
    }
    if (command === "generate-test") {
      const policy = await WorkspacePolicy.create();
      const result = await new RegressionService(policy).generate({
        runId: f.run ? String(f.run) : undefined,
        flowPath: f.flow ? String(f.flow) : undefined,
        outPath: f.out ? String(f.out) : undefined,
        dryRun: Boolean(f["dry-run"]) || !f.out,
        force: Boolean(f.force),
        draft: Boolean(f.draft),
        signal,
      });
      emit(
        result,
        [
          JSON.stringify(result, null, 2),
          "Review the full file; supply JP_BASE_URL and requiredEnv. Drafts are non-executable.",
          "Checkout execution command (requires its regression.playwright.config.ts):",
          "JP_SPEC_NAME='" +
            basename(result.path ?? "REVIEWED.spec.ts") +
            "' npx playwright test --config regression.playwright.config.ts",
          "In other workspaces configure Playwright to include tests/generated. Never run a truncated preview.",
        ].join("\n"),
      );
      return result.eligible || result.draft ? 0 : 2;
    }
    if (command === "coverage") {
      if (
        !f.flow ||
        !f.runs ||
        (f.format && !["json", "table"].includes(String(f.format)))
      )
        throw new InputError(
          "coverage requires --flow FILE --runs ID,ID [--format table|json]",
        );
      const policy = await WorkspacePolicy.create();
      const loaded = await loadJourney(await policy.flow(String(f.flow)));
      const ids = String(f.runs).split(",");
      if (ids.length > 20)
        throw new InputError("Coverage accepts at most 20 runs");
      await policy.artifactRoot(false);
      const sources = [];
      for (const id of ids)
        sources.push(await new MapService(policy.artifacts).source(id));
      const report = workflowCoverage(
        loaded.journey,
        loaded.source.checksum,
        sources,
      );
      io.out(
        json || f.format === "json"
          ? JSON.stringify(report)
          : coverageTable(report),
      );
      return 0;
    }
    if (command === "report") {
      const paths = await regenerateReport(output, String(f.run));
      io.out(paths.html);
      if (f.open && !(await openReport(paths.html)))
        io.err("Could not open browser. Open the HTML path manually.");
      return 0;
    }
    const loaded = await loadJourney(String(f.flow));
    const result = await runJourney({
      ...loaded,
      flowPath: String(f.flow),
      baseUrl: f["base-url"] ? String(f["base-url"]) : undefined,
      outputDir: output,
      timeoutMs: f["timeout-ms"] ? Number(f["timeout-ms"]) : undefined,
      headed: Boolean(f.headed),
      allowRemote: Boolean(f["allow-remote"]),
      signal,
    });
    emit(
      result,
      `${result.run.status.toUpperCase()} ${result.run.id}\nJSON: ${result.paths.json}\nHTML: ${result.paths.html}`,
    );
    return exitCode(result.run.status);
  } catch (error) {
    // Runtime errors can contain arbitrary browser text. Engine owns redaction;
    // failures outside the engine get a fixed diagnostic unless a safe InputError.
    const message =
      error instanceof InputError
        ? error.message
        : error instanceof PolicyError
          ? "Workspace policy denied this request. Check JOURNEYPROOF_WORKSPACE_ROOT, approved JOURNEYPROOF_FLOW_ROOT and relative paths; MCP/generated execution uses numeric loopback only."
          : args[0] === "report"
            ? "Tool could not read this report. Report unavailable. Use a saved run ID and its original --output-dir; check artifact permissions and JSON integrity."
            : "Tool could not complete the command; check file permissions, artifacts and browser installation. Run doctor and see docs/TROUBLESHOOTING.md";
    if (json)
      io.out(JSON.stringify({ status: "error", error: message, exitCode: 2 }));
    else io.err(message);
    return 2;
  }
}
