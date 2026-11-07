import { z } from "zod";
import { routeSchema, roleSchema } from "../map/normalize.js";
export const observationLimitsSchema = z.strictObject({
  maxEvents: z.number().int().min(20).max(1000).default(400),
  maxLinksPerPage: z.number().int().min(0).max(30).default(12),
  maxLinks: z.number().int().min(0).max(100).default(60),
  maxBytes: z.number().int().min(16384).max(262144).default(131072),
  scanIntervalMs: z.number().int().min(100).max(2000).default(250),
});
export const eventSchema = z.strictObject({
  seq: z.number().int().nonnegative(),
  atMs: z.number().nonnegative(),
  startedAtMs: z.number().nonnegative().optional(),
  type: z.enum(["navigation", "step", "link", "popup"]),
  pageId: z.string().regex(/^page-[0-9]{1,4}$/),
  openerPageId: z.enum(["page-1", "unknown"]).optional(),
  stepId: z.string().max(64).optional(),
  route: routeSchema.optional(),
  before: routeSchema.optional(),
  target: routeSchema.optional(),
  outcome: z.enum(["passed", "failed", "skipped", "blocked"]).optional(),
});
export const observationsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().regex(/^\d{13}-[a-f0-9]{8}$/),
  flowName: z.string().max(80),
  flowFingerprint: z.string().regex(/^[a-f0-9]{20}$/),
  role: roleSchema.optional(),
  declarations: z
    .array(
      z.strictObject({
        stepId: z.string().max(64),
        route: routeSchema.optional(),
      }),
    )
    .max(100),
  events: z.array(eventSchema).max(1000),
  truncated: z.boolean(),
});
export type Observations = z.infer<typeof observationsSchema>;
export type ObservationEvent = z.infer<typeof eventSchema>;
