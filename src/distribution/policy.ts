import { parseDocument } from "yaml";
import { createHash } from "node:crypto";
import { InputError } from "../shared/errors.js";
// Conservative literal-command guard, not a shell sandbox or code auditor.
const forbidden = {
  test(value: string) {
    const text = value.replace(/["']/g, "").replace(/\\\r?\n/g, " ");
    return /\b(?:npm|pnpm|yarn|bun)\b[^;\n&|]*\s(?:publish|stage\s+publish)(?:\s|$)|\bgit\b[^;\n&|]*\spush(?:\s|$)|\bgh\b[^;\n&|]*\s(?:release\s+create|repo\s+edit)(?:\s|$)|\bmcp-publisher(?:@[a-zA-Z0-9.+-]+)?\b[^;\n&|]*\spublish(?:\s|$)/.test(
      text,
    );
  },
};
export function auditPackageScripts(input: unknown) {
  if (
    input !== undefined &&
    (!input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.values(input).some((v) => typeof v !== "string"))
  )
    throw new InputError("Invalid package scripts");
  const scripts = input as Record<string, string> | undefined;
  if (
    Object.keys(scripts ?? {}).some((key) =>
      /^(?:preinstall|install|postinstall|prepare|prepack|postpack|prepublish|prepublishOnly|publish|postpublish)$/.test(
        key,
      ),
    )
  )
    throw new InputError(
      "Distribution lifecycle hooks are disabled; no hidden install/pack/release operations",
    );
  if (Object.values(scripts ?? {}).some((value) => forbidden.test(value)))
    throw new InputError("Live publishing command found in package scripts");
}

export function auditReleasePolicy(
  metadata: {
    private?: boolean;
    license?: string;
    mcpName?: unknown;
    scripts?: Record<string, string>;
  },
  workflows: string[],
) {
  // Source licensing never authorizes a publication or registry identity claim.
  if (metadata.private !== true || metadata.mcpName !== undefined)
    throw new InputError(
      "Owner publication decision required; preserve private state and absent mcpName",
    );
  if (metadata.license !== "Apache-2.0")
    throw new InputError(
      "Owner license decision required; expected Apache-2.0 source license",
    );
  auditPackageScripts(metadata.scripts);
  if (!workflows.length) throw new InputError("Validation workflow missing");
  for (const content of workflows) {
    // The stage-only workflow is an explicitly reviewed exact document. Any
    // alteration falls through to the strict validation-only checks below.
    if (
      createHash("sha256").update(content).digest("hex") ===
      "dda949a450f4b33e7c71582e79e86cbf4d4fc61cfca118e04f897b9658504c56"
    )
      continue;
    const doc = parseDocument(content, { uniqueKeys: true });
    if (
      doc.errors.length ||
      doc.warnings.length ||
      forbidden.test(content) ||
      /continue-on-error|\|\|\s*true/.test(content)
    )
      throw new InputError(
        "Workflow is invalid or contains a live publication command",
      );
    let workflow;
    try {
      workflow = doc.toJS({ maxAliasCount: 0 }) as {
        on?: unknown;
        permissions?: unknown;
        jobs?: Record<string, { permissions?: unknown; steps?: unknown[] }>;
      };
    } catch {
      throw new InputError("Workflow aliases are unsupported");
    }
    if (
      !workflow ||
      typeof workflow !== "object" ||
      JSON.stringify(workflow.on ?? {}).includes("pull_request_target")
    )
      throw new InputError("Privileged pull request trigger denied");
    const readOnly = (value: unknown) =>
      Boolean(
        value &&
        typeof value === "object" &&
        Object.keys(value).length === 1 &&
        Object.entries(value).every(
          ([key, permission]) => key === "contents" && permission === "read",
        ),
      );
    if (
      !readOnly(workflow.permissions) ||
      Object.values(workflow.jobs ?? {}).some(
        (job) => job.permissions !== undefined && !readOnly(job.permissions),
      )
    )
      throw new InputError(
        "Validation workflows require contents: read only; no write/OIDC permissions",
      );
    if (JSON.stringify(workflow.jobs).includes("actions/upload-artifact"))
      throw new InputError(
        "Artifact upload is disabled until a separate reviewed retention/privacy decision",
      );
  }
  return {
    validationWorkflows: workflows.length,
    publicationAuthorized: false as const,
    private: true as const,
  };
}
