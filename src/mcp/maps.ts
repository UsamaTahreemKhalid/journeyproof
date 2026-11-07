import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { WorkspacePolicy } from "./policy.js";
import { safeInput } from "./schemas.js";
import { MapService } from "../map/service.js";
import { MapError } from "../map/errors.js";
import { runIdSchema, mapIdSchema } from "../map/schema.js";
import { roleSchema } from "../map/normalize.js";
export const mapInputs = {
  build: z
    .strictObject({
      runId: runIdSchema.optional(),
      compareRunIds: z.tuple([runIdSchema, runIdSchema]).optional(),
      role: roleSchema.optional(),
    })
    .refine(
      (value) => Boolean(value.runId) !== Boolean(value.compareRunIds),
      "Choose one run or a comparison pair",
    ),
  get: z.strictObject({
    mapId: mapIdSchema,
    detail: z.number().int().min(0).max(10).default(0),
  }),
};
export const mapOutputSchema = z.strictObject({
  status: z.enum(["ok", "error"]),
  data: z
    .strictObject({
      mapId: mapIdSchema,
      sourceRunIds: z.array(runIdSchema).min(1).max(2),
      summary: z.strictObject({
        observedNodes: z.number().int(),
        observedEdges: z.number().int(),
        observedPages: z.number().int(),
        passedSteps: z.number().int(),
        failedSteps: z.number().int(),
        notReachedSteps: z.number().int(),
        linkedUnvisited: z.number().int(),
        configuredSteps: z.number().int(),
      }),
      firstDivergence: z.string().max(64).optional(),
      warnings: z.array(z.string().max(300)).max(20),
      paths: z.strictObject({
        json: z.string().max(500),
        html: z.string().max(500),
      }),
      nodes: z
        .array(
          z.strictObject({
            id: z.string().max(30),
            kind: z.enum(["page", "action"]),
            status: z.string().max(30),
          }),
        )
        .max(10)
        .optional(),
      edges: z
        .array(
          z.strictObject({
            id: z.string().max(30),
            from: z.string().max(30),
            to: z.string().max(30),
            status: z.string().max(30),
          }),
        )
        .max(10)
        .optional(),
      truncated: z.boolean(),
      untrustedData: z.literal(true),
    })
    .optional(),
  code: z.string().max(40).optional(),
  message: z.string().max(300).optional(),
});
export function registerMapTools(
  server: McpServer,
  policy: WorkspacePolicy,
  signal: AbortSignal,
) {
  const service = new MapService(policy.artifacts);
  const result = (data: unknown) => {
    const parsed = mapOutputSchema.parse({ status: "ok", data });
    return {
      structuredContent: parsed,
      content: [{ type: "text" as const, text: JSON.stringify(parsed) }],
      isError: false,
    };
  };
  const errorResult = (error: unknown) => {
    const parsed = mapOutputSchema.parse({
      status: "error",
      code: error instanceof MapError ? error.code : "INVALID_ARTIFACT",
      message:
        error instanceof MapError
          ? error.message
          : "Map operation unavailable; check approved run IDs, artifacts and permissions.",
    });
    return {
      structuredContent: parsed,
      content: [{ type: "text" as const, text: JSON.stringify(parsed) }],
      isError: true,
    };
  };
  server.registerTool(
    "journeyproof_build_map",
    {
      description:
        "Build an offline local workflow map or compatible-run comparison from actual saved runs. Creates a portable report folder; never browses or follows links. Role labels are descriptive, not authorization evidence.",
      inputSchema: safeInput(mapInputs.build),
      outputSchema: mapOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, context) => {
      try {
        await policy.artifactRoot(false);
        const combined = AbortSignal.any([signal, context.mcpReq.signal]);
        const resultMap = await service.build(
          args.compareRunIds ?? [args.runId!],
          args.role,
          combined,
        );
        return result(
          service.summary(resultMap.map, resultMap.paths, policy.root),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  server.registerTool(
    "journeyproof_get_map",
    {
      description:
        "Read a saved map by safe ID from the approved artifact root. Returns bounded factual counts, divergence and up to ten node/edge snippets. No page text, HTML, screenshots, trace contents or credentials.",
      inputSchema: safeInput(mapInputs.get),
      outputSchema: mapOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, context) => {
      try {
        if (signal.aborted || context.mcpReq.signal.aborted)
          throw new MapError("CANCELLED");
        await policy.artifactRoot(false);
        const stored = await service.get(args.mapId);
        return result(
          service.summary(stored.map, stored.paths, policy.root, args.detail),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
