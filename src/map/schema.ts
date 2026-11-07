import { z } from "zod";
import { roleSchema } from "./normalize.js";
export const runIdSchema = z.string().regex(/^\d{13}-[a-f0-9]{8}$/);
export const mapIdSchema = z.string().regex(/^map-[a-f0-9]{20}$/);
export const stateSchema = z.enum([
  "observed_passed",
  "observed_failed",
  "observed_unasserted",
  "linked_unvisited",
  "declared_unreached",
  "unknown",
]);
export const evidenceSchema = z.strictObject({
  runId: runIdSchema,
  kind: z.enum(["report", "json", "screenshot", "trace"]),
  path: z
    .string()
    .regex(
      /^evidence\/\d{13}-[a-f0-9]{8}\/(?:report\.html|report\.json|failure\.png|trace\.zip)$/,
    ),
  available: z.boolean(),
});
const provenanceSchema = z.strictObject({
  runId: runIdSchema,
  stepId: z.string().max(64).optional(),
  sequence: z.number().int().nonnegative(),
  atMs: z.number().nonnegative().optional(),
  status: stateSchema,
  detail: z.string().max(500).optional(),
  basis: z.enum([
    "step-result",
    "browser-navigation",
    "step-url",
    "visible-anchor",
    "flow-declaration",
    "legacy-result",
    "blocked-popup",
  ]),
});
export const nodeSchema = z.strictObject({
  id: z.string().regex(/^n-[a-f0-9]{20}$/),
  kind: z.enum(["page", "action"]),
  title: z.string().max(150),
  route: z.string().max(500).optional(),
  status: stateSchema,
  stepIds: z.array(z.string().max(64)).max(100),
  sequence: z.number().int().nonnegative(),
  provenance: z.array(provenanceSchema).max(2000),
  evidence: z.array(evidenceSchema).max(8),
  detail: z.string().max(500),
  http: z
    .array(
      z.strictObject({
        runId: runIdSchema,
        method: z.string().max(10),
        path: z.string().max(500),
        status: z.number().int(),
      }),
    )
    .max(20)
    .optional(),
});
export const edgeSchema = z.strictObject({
  id: z.string().regex(/^e-[a-f0-9]{20}$/),
  from: z.string().regex(/^n-[a-f0-9]{20}$/),
  to: z.string().regex(/^n-[a-f0-9]{20}$/),
  kind: z.enum([
    "navigation",
    "action",
    "declared",
    "visible-link",
    "sequence",
    "blocked-popup",
  ]),
  status: stateSchema,
  provenance: z.array(provenanceSchema).max(2000),
});
export const comparisonSchema = z.strictObject({
  baselineRunId: runIdSchema,
  candidateRunId: runIdSchema,
  firstDivergence: z.string().max(64).optional(),
  changes: z
    .array(
      z.strictObject({
        stepId: z.string().max(64),
        baseline: z.enum(["passed", "failed", "skipped"]),
        candidate: z.enum(["passed", "failed", "skipped"]),
      }),
    )
    .max(100),
  addedTransitions: z.array(z.string()).max(1500),
  removedTransitions: z.array(z.string()).max(1500),
  httpChanges: z
    .array(
      z.strictObject({
        method: z.string().max(10),
        path: z.string().max(500),
        baseline: z.array(z.number()).max(200),
        candidate: z.array(z.number()).max(200),
      }),
    )
    .max(200),
});
export const mapSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    mapId: mapIdSchema,
    createdAt: z.iso.datetime(),
    generatorVersion: z.string().max(30),
    sourceRunIds: z.array(runIdSchema).min(1).max(2),
    flows: z
      .array(
        z.strictObject({
          id: z.string().max(30),
          name: z.string().max(80),
          runId: runIdSchema,
          role: roleSchema.optional(),
          status: z.enum(["passed", "failed", "error"]),
          startedAt: z.iso.datetime(),
          counts: z.strictObject({
            passed: z.number().int().nonnegative(),
            failed: z.number().int().nonnegative(),
            skipped: z.number().int().nonnegative(),
          }),
        }),
      )
      .min(1)
      .max(2),
    roleFilter: roleSchema.optional(),
    nodes: z.array(nodeSchema).max(500),
    edges: z.array(edgeSchema).max(1500),
    summary: z.strictObject({
      observedNodes: z.number().int().nonnegative(),
      observedEdges: z.number().int().nonnegative(),
      observedPages: z.number().int().nonnegative(),
      passedSteps: z.number().int().nonnegative(),
      failedSteps: z.number().int().nonnegative(),
      notReachedSteps: z.number().int().nonnegative(),
      linkedUnvisited: z.number().int().nonnegative(),
      configuredSteps: z.number().int().nonnegative(),
    }),
    comparison: comparisonSchema.optional(),
    warnings: z.array(z.string().max(300)).max(20),
    limitations: z.array(z.string().max(300)).max(10),
    evidence: z.array(evidenceSchema).max(8),
  })
  .superRefine((map, ctx) => {
    const nodes = new Set(map.nodes.map((n) => n.id));
    if (
      nodes.size !== map.nodes.length ||
      new Set(map.edges.map((e) => e.id)).size !== map.edges.length ||
      map.edges.some((edge) => !nodes.has(edge.from) || !nodes.has(edge.to))
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid graph references or duplicate IDs",
      });
    const runs = new Set(map.sourceRunIds);
    if (
      map.flows.some((flow) => !runs.has(flow.runId)) ||
      map.nodes.some((n) => n.provenance.some((p) => !runs.has(p.runId)))
    )
      ctx.addIssue({ code: "custom", message: "Invalid provenance run" });
  });
export type MapDocument = z.infer<typeof mapSchema>;
export type MapNode = z.infer<typeof nodeSchema>;
export type MapEdge = z.infer<typeof edgeSchema>;
export type State = z.infer<typeof stateSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
