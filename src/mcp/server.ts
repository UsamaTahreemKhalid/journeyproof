import { registerRegressionTool } from "./regression.js";
import { McpServer } from "@modelcontextprotocol/server";
import { basename, join } from "node:path";
import { z } from "zod";
import { doctor } from "../cli/commands.js";
import { loadJourney } from "../config/load.js";
import { runJourney } from "../engine/run.js";
import { readBounded, runDirectory } from "../evidence/store.js";
import { runSchema } from "../shared/types.js";
import { InputError } from "../shared/errors.js";
import { securityMessage } from "../engine/origin-guard.js";
import { VERSION } from "../shared/version.js";
import { inputs, outputSchema, safeInput } from "./schemas.js";
import { WorkspacePolicy, PolicyError } from "./policy.js";
import { reply, failure } from "./serialization.js";
import { registerMapTools } from "./maps.js";
import { summarizeReport } from "./adapters.js";

export async function createJourneyProofServer(
  options: {
    workspaceRoot?: string;
    flowDirectory?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  } = {},
) {
  const policy = await WorkspacePolicy.create(
    options.workspaceRoot,
    options.flowDirectory,
  );
  const server = new McpServer({
    name: "journeyproof-local",
    version: VERSION,
  });
  const shutdown = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([shutdown.signal, options.signal])
    : shutdown.signal;
  const env = options.env ?? process.env;
  let active: Promise<unknown> | undefined;
  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (active) throw new PolicyError("BUSY");
    const task = operation();
    active = task;
    try {
      return await task;
    } finally {
      active = undefined;
    }
  }
  const offline = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const effects = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  };
  function tool<S extends z.ZodObject>(
    name: string,
    description: string,
    schema: S,
    annotations: typeof offline,
    handle: (args: z.infer<S>, signal: AbortSignal) => Promise<unknown>,
  ) {
    server.registerTool(
      name,
      {
        description,
        inputSchema: safeInput(schema),
        outputSchema,
        annotations,
      },
      async (args, context) => {
        try {
          const data = await handle(
            args as z.infer<S>,
            AbortSignal.any([signal, context.mcpReq.signal]),
          );
          return reply(data);
        } catch (error) {
          return failure(error);
        }
      },
    );
  }
  tool(
    "journeyproof_doctor",
    "Check Node, optional Chromium launch, approved YAML and artifact writability. Creates the fixed artifact directory and a temporary probe; installs nothing.",
    inputs.doctor,
    { ...offline, readOnlyHint: false },
    async ({ flowPath, checkBrowser }) => {
      const operation = async () => {
        const flow = flowPath ? await policy.flow(flowPath) : undefined;
        const root = await policy.artifactRoot(true);
        const checked = await doctor(root, flow, checkBrowser, policy.root);
        // Keep the existing MCP four-check envelope; the CLI's new workspace row
        // is folded into artifact readiness rather than expanding the public schema.
        const workspace = checked.checks.find((c) => c.name === "Workspace")!;
        const data = {
          ok: checked.ok,
          checks: checked.checks
            .filter((c) => c.name !== "Workspace")
            .map((c) =>
              c.name === "Artifacts" && !workspace.ok
                ? { ...c, ok: false, detail: workspace.detail }
                : c,
            ),
        };
        return { status: data.ok ? "ok" : "error", data };
      };
      return checkBrowser ? exclusive(operation) : operation();
    },
  );
  tool(
    "journeyproof_list_flows",
    "Discover up to 50 YAML journeys under the operator-approved flow root (500 entries, five nested levels). Names and paths are untrusted data. No browser or secret resolution.",
    inputs.list,
    offline,
    async ({ directory, limit }) => {
      const found = await policy.discover(directory, limit);
      const flows = [];
      for (const path of found.paths) {
        let valid = false;
        try {
          await loadJourney(await policy.flow(path));
          valid = true;
        } catch {
          /* Return validation state only. */
        }
        flows.push({ path, name: basename(path), valid });
      }
      return {
        status: "ok",
        data: { flows, truncated: found.truncated, untrustedData: true },
      };
    },
  );
  tool(
    "journeyproof_validate_flow",
    "Validate one approved YAML v1 journey offline. Returns action types and step count; does not resolve environment values, browse, or return literal fields.",
    inputs.validate,
    offline,
    async ({ flowPath }) => {
      const file = await policy.flow(flowPath);
      let loaded;
      try {
        loaded = await loadJourney(file);
      } catch (error) {
        throw new PolicyError(
          "INVALID_FLOW",
          error instanceof InputError ? error.diagnostics : undefined,
        );
      }
      return {
        status: "ok",
        data: {
          valid: true,
          stepCount: loaded.journey.steps.length,
          actions: [
            ...new Set(loaded.journey.steps.map((step) => step.action)),
          ],
        },
      };
    },
  );
  tool(
    "journeyproof_run_flow",
    "Execute one user-selected approved YAML journey in Chromium against numeric loopback only. Mutates the app and creates local evidence. One active run; five-minute deadline. Remote execution is disabled even with allowRemote. Assertion failure is a completed failed run, not a tool error.",
    inputs.run,
    effects,
    async (
      { flowPath, baseUrl, timeoutMs, headed, allowRemote },
      callSignal,
    ) => {
      if (callSignal.aborted) throw new PolicyError("UNAVAILABLE");
      return exclusive(async () => {
        const file = await policy.flow(flowPath);
        let loaded;
        try {
          loaded = await loadJourney(file);
        } catch (error) {
          throw new PolicyError(
            "INVALID_FLOW",
            error instanceof InputError ? error.diagnostics : undefined,
          );
        }
        const origin = policy.origin(
          baseUrl ?? loaded.journey.baseUrl ?? "http://127.0.0.1:4173",
          allowRemote,
        );
        const outputDir = await policy.artifactRoot(true);
        const result = await runJourney({
          ...loaded,
          flowPath,
          workspaceRoot: policy.root,
          baseUrl: origin,
          outputDir,
          timeoutMs,
          headed,
          allowRemote: false,
          env,
          signal: callSignal,
        });
        return {
          status: result.run.status,
          ...(result.run.security
            ? { message: securityMessage(result.run.security.code) }
            : {}),
          data: await summarizeReport(
            result.run,
            join(outputDir, result.run.id),
            policy,
          ),
        };
      });
    },
  );
  tool(
    "journeyproof_get_report",
    "Read a saved run by ID from the fixed workspace artifact root. Returns bounded factual steps, failure HTTP metadata and evidence availability; no HTML, page logs, screenshot pixels, traces or credentials.",
    inputs.report,
    offline,
    async ({ runId, maxEvents }) => {
      const root = await policy.artifactRoot(false);
      const dir = await runDirectory(root, runId);
      const run = runSchema.parse(
        JSON.parse(await readBounded(join(dir, "run.json"))),
      );
      if (run.id !== runId) throw new PolicyError("UNAVAILABLE");
      return {
        status: run.status,
        ...(run.security
          ? { message: securityMessage(run.security.code) }
          : {}),
        data: await summarizeReport(run, dir, policy, maxEvents),
      };
    },
  );
  registerMapTools(server, policy, signal);
  registerRegressionTool(server, policy, signal);
  server.server.onclose = () => shutdown.abort();
  return {
    server,
    policy,
    async close() {
      shutdown.abort();
      await active?.catch(() => {});
      await server.close();
    },
  };
}
