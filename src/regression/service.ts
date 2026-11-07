import { join, dirname, resolve } from "node:path";
import { readFile, mkdir, writeFile, rename, link, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { WorkspacePolicy, relativePath } from "../mcp/policy.js";
import { MapService } from "../map/service.js";
import { checkedPath, regularFile, readJson } from "../map/storage.js";
import { loadJourney } from "../config/load.js";
import { InputError } from "../shared/errors.js";
import { sourceLinkSchema } from "./model.js";
import { toPlan } from "./from-journey.js";
import { emitPlaywright } from "./emit-playwright.js";
export interface GenerateOptions {
  runId?: string;
  flowPath?: string;
  outPath?: string;
  dryRun?: boolean;
  force?: boolean;
  draft?: boolean;
  signal?: AbortSignal;
}
export class RegressionService {
  constructor(readonly policy: WorkspacePolicy) {}
  async generate(options: GenerateOptions) {
    const check = () => {
      if (options.signal?.aborted) throw new InputError("Generation cancelled");
    };
    check();
    if (Boolean(options.runId) === Boolean(options.flowPath))
      throw new InputError("Choose exactly one run ID or flow path");
    let flowPath = options.flowPath;
    let source;
    if (options.runId) {
      await this.policy.artifactRoot(false);
      source = await new MapService(this.policy.artifacts).source(
        options.runId,
      );
      const file = join(this.policy.artifacts, source.run.id, "source.json");
      const parsed = sourceLinkSchema.safeParse(
        await readJson(
          await checkedPath(file).catch(() => {
            throw new InputError(
              "Source linkage unavailable; rerun the approved flow or use definition-only --flow",
            );
          }),
          2048,
        ),
      );
      if (
        !parsed.success ||
        parsed.data.checksum !== source.run.metadata.checksum
      )
        throw new InputError(
          "Source linkage unavailable or incompatible; rerun the approved flow, or use definition-only --flow",
        );
      flowPath = parsed.data.flowPath;
    }
    const approved = await this.policy.flow(flowPath!);
    const loaded = await loadJourney(approved).catch(() => {
      throw new InputError(
        "Approved flow is invalid or unavailable; validate its schema before generation",
      );
    });
    const plan = toPlan(loaded.journey, loaded.source.checksum, source);
    check();
    // Ineligible definitions never expose private selectors/assertions in a draft or preview.
    const code = options.draft
      ? `# NOT VERIFIED — NON-EXECUTABLE DRAFT\n\nSource: ${plan.source.flowId}\nDiagnostics: ${plan.diagnostics.join(", ") || "Draft requested"}\nReview the approved YAML manually. No executable test was generated.\n`
      : plan.eligible
        ? await emitPlaywright(plan)
        : "";
    if (Buffer.byteLength(code) > 131072)
      throw new InputError("Generated output exceeds 128 KiB");
    let path: string | undefined;
    let written = false;
    if (options.outPath) {
      relativePath(options.outPath);
      if (
        !options.outPath.startsWith("tests/generated/") ||
        !(options.draft
          ? options.outPath.endsWith(".draft.md")
          : options.outPath.endsWith(".spec.ts"))
      )
        throw new InputError(
          "Output must be tests/generated/*.spec.ts (drafts: *.draft.md)",
        );
      path = options.outPath;
      const target = await checkedPath(resolve(this.policy.root, path), true);
      const exists = await regularFile(target, 131072);
      if (!options.dryRun && code) {
        const identical = exists && (await readFile(target, "utf8")) === code;
        if (exists && !identical && !options.force)
          throw new InputError(
            "Output already exists; review it and explicitly opt into CLI --force",
          );
        if (!identical) {
          check();
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          await checkedPath(dirname(target));
          const temp = target + "." + randomUUID() + ".tmp";
          try {
            await writeFile(temp, code, { flag: "wx", mode: 0o600 });
            check();
            if (options.force) await rename(temp, target);
            else await link(temp, target); // Atomic create: a concurrent writer cannot be overwritten.
            written = true;
          } finally {
            await rm(temp, { force: true });
          }
        }
      }
    }
    check();
    const preview = Buffer.from(code)
      .subarray(0, 12000)
      .toString("utf8")
      .replace(/\uFFFD$/u, "");
    return {
      schemaVersion: 1 as const,
      eligible: plan.eligible,
      draft: Boolean(options.draft),
      source: plan.source,
      steps: plan.journey.steps.length,
      assertions: plan.journey.steps.filter((s) =>
        s.action.startsWith("expect"),
      ).length,
      supportedActions: [...new Set(plan.journey.steps.map((s) => s.action))],
      unsupportedActions: [] as string[],
      diagnostics: plan.diagnostics,
      requiredEnv: plan.journey.steps.flatMap((s) =>
        s.action === "fill" ? [s.valueFromEnv!] : [],
      ),
      path,
      written,
      preview,
      truncated: Buffer.byteLength(code) > 12000,
      untrustedData: true as const,
    };
  }
}
