import { parseDocument } from "yaml";
import { z } from "zod";
import { InputError } from "../shared/errors.js";
import { auditPackageScripts } from "./policy.js";
const permissions = z.strictObject({ contents: z.literal("read") });
const uses = z.strictObject({
  uses: z.string().regex(/^actions\/(?:checkout|setup-node)@[a-f0-9]{40}$/),
  with: z.record(z.string(), z.unknown()).optional(),
});
const schema = z.strictObject({
  name: z.string().min(1),
  on: z.literal("workflow_dispatch"),
  permissions,
  jobs: z.strictObject({
    publisher: z.strictObject({
      if: z.literal("${{ false }}"),
      environment: z.literal("OWNER_UNSELECTED_PROTECTED_ENVIRONMENT"),
      "runs-on": z.literal("ubuntu-latest"),
      permissions: permissions.extend({ "id-token": z.literal("write") }),
      steps: z
        .array(z.union([uses, z.strictObject({ run: z.string().min(1) })]))
        .min(3),
    }),
  }),
});
export function auditInactivePublisher(content: string) {
  try {
    const doc = parseDocument(content, { uniqueKeys: true });
    if (doc.errors.length || doc.warnings.length) throw Error();
    const draft = schema.parse(doc.toJS({ maxAliasCount: 0 }));
    const steps = draft.jobs.publisher.steps;
    const setup = steps.filter(
      (s) => "uses" in s && s.uses.startsWith("actions/setup-node@"),
    );
    if (setup.length !== 1) throw Error();
    const config = uses.parse(setup[0]).with;
    if (
      config?.["node-version"] !== 24 ||
      config["package-manager-cache"] !== false ||
      "cache" in config ||
      Object.keys(config).length !== 2
    )
      throw Error();
    if (
      !steps.some((s) => "uses" in s && s.uses.startsWith("actions/checkout@"))
    )
      throw Error();
    const commands = steps.flatMap((s) => ("run" in s ? [s.run] : []));
    if (
      commands.length !== 3 ||
      new Set(commands).size !== 3 ||
      steps.length !== 5
    )
      throw Error();
    for (const step of steps) {
      if ("run" in step) {
        auditPackageScripts({ draft: step.run });
        if (
          ![
            "npm ci",
            "npx playwright install --with-deps chromium",
            "npm run rc:prepare",
          ].includes(step.run)
        )
          throw Error();
      } else if (
        step.uses.startsWith("actions/checkout@") &&
        step.with !== undefined
      )
        throw Error();
    }
    return {
      inactive: true as const,
      publicationAuthorized: false as const,
      releaseCache: false as const,
    };
  } catch {
    throw new InputError(
      "Unsafe or invalid inactive publication template; owner review required",
    );
  }
}
