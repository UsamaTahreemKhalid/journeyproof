import { join, relative, resolve } from "node:path";
import { mkdir, rm, readFile } from "node:fs/promises";
import {
  DEFAULT_OUTPUT,
  runDirectory,
  writePrivate,
} from "../evidence/store.js";
import { runSchema, type RunResult } from "../shared/types.js";
import { renderReport } from "../report/render.js";
import { sanitizeTrace } from "../evidence/trace.js";
import { observationsSchema } from "../observations/schema.js";
import { buildMap, type MapSource } from "./build.js";
import {
  mapSchema,
  mapIdSchema,
  runIdSchema,
  type MapDocument,
} from "./schema.js";
import { MapError } from "./errors.js";
import { safeReason, safeToken, routeFor, roleSchema } from "./normalize.js";
import { checkedPath, regularFile, readJson, mapRoot } from "./storage.js";
import { renderExplorer } from "../viewer/render.js";

export class MapService {
  private busy = false;
  constructor(readonly runRoot = DEFAULT_OUTPUT) {}
  async get(id: string) {
    if (!mapIdSchema.safeParse(id).success) throw new MapError("PATH_DENIED");
    const root = await mapRoot(this.runRoot, false);
    const dir = await checkedPath(join(root, id));
    const map = mapSchema.safeParse(
      await readJson(join(dir, "map.json"), 1024 * 1024),
    );
    if (!map.success || map.data.mapId !== id)
      throw new MapError("INVALID_ARTIFACT");
    if (!(await regularFile(join(dir, "index.html"), 2 * 1024 * 1024)))
      throw new MapError("INVALID_ARTIFACT");
    return { map: map.data, paths: this.paths(dir) };
  }
  private paths(dir: string) {
    return { json: join(dir, "map.json"), html: join(dir, "index.html") };
  }
  async source(id: string): Promise<MapSource> {
    if (!runIdSchema.safeParse(id).success) throw new MapError("PATH_DENIED");
    await checkedPath(this.runRoot);
    let dir: string;
    try {
      dir = await runDirectory(this.runRoot, id);
    } catch {
      throw new MapError("MISSING_RUN");
    }
    const parsed = runSchema.safeParse(
      await readJson(join(dir, "run.json"), 2 * 1024 * 1024),
    );
    if (!parsed.success || parsed.data.id !== id)
      throw new MapError("INVALID_ARTIFACT");
    let observations;
    if (await regularFile(join(dir, "observations.json"), 262144)) {
      const obs = observationsSchema.safeParse(
        await readJson(join(dir, "observations.json"), 262144),
      );
      if (!obs.success || obs.data.runId !== id)
        throw new MapError("INVALID_ARTIFACT");
      observations = obs.data;
    }
    const evidence: MapDocument["evidence"] = [
      {
        runId: id,
        kind: "report",
        path: `evidence/${id}/report.html`,
        available: true,
      },
      {
        runId: id,
        kind: "json",
        path: `evidence/${id}/report.json`,
        available: true,
      },
      {
        runId: id,
        kind: "screenshot",
        path: `evidence/${id}/failure.png`,
        available:
          Boolean(observations) &&
          (await regularFile(join(dir, "failure.png"), 4 * 1024 * 1024)),
      },
      {
        runId: id,
        kind: "trace",
        path: `evidence/${id}/trace.zip`,
        available: await regularFile(join(dir, "trace.zip"), 12 * 1024 * 1024),
      },
    ];
    return { run: parsed.data, observations, evidence };
  }
  async build(runIds: string[], role?: string, signal?: AbortSignal) {
    if (this.busy) throw new MapError("BUSY");
    this.busy = true;
    let created: string | undefined;
    const check = () => {
      if (signal?.aborted) throw new MapError("CANCELLED");
    };
    try {
      check();
      if (role && !roleSchema.safeParse(role).success)
        throw new MapError("INVALID_ARTIFACT");
      if (!runIds.length || runIds.length > 2)
        throw new MapError("INVALID_ARTIFACT");
      const sources = [];
      for (const id of runIds) {
        check();
        sources.push(await this.source(id));
      }
      const map = buildMap(sources, role);
      if (Buffer.byteLength(JSON.stringify(map)) > 1024 * 1024)
        throw new MapError("LIMIT_EXCEEDED");
      const root = await mapRoot(this.runRoot, true);
      const dir = await checkedPath(join(root, map.mapId), true);
      if (await regularFile(join(dir, "map.json"), 1024 * 1024))
        return this.get(map.mapId);
      try {
        await mkdir(dir, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new MapError("BUSY");
        throw error;
      }
      created = dir;
      for (const source of sources.filter((source) =>
        map.sourceRunIds.includes(source.run.id),
      )) {
        check();
        const out = join(dir, "evidence", source.run.id);
        await mkdir(out, { recursive: true, mode: 0o700 });
        const excerpt = safeExcerpt(
          source.run,
          source.evidence,
          source.observations?.flowName,
        );
        await writePrivate(
          join(out, "report.json"),
          JSON.stringify(excerpt, null, 2) + "\n",
        );
        const available = new Set(
          source.evidence
            .filter((e) => e.available)
            .map((e) =>
              e.kind === "screenshot"
                ? "failure.png"
                : e.kind === "trace"
                  ? "trace.zip"
                  : "",
            ),
        );
        await writePrivate(
          join(out, "report.html"),
          renderReport(excerpt, available),
        );
        for (const item of source.evidence.filter(
          (e) => e.available && ["screenshot", "trace"].includes(e.kind),
        )) {
          check();
          const filename = item.kind === "trace" ? "trace.zip" : "failure.png";
          const original = join(this.runRoot, source.run.id, filename);
          await regularFile(
            original,
            item.kind === "trace" ? 12 * 1024 * 1024 : 4 * 1024 * 1024,
          );
          const data = await readFile(original);
          await writePrivate(
            join(out, filename),
            item.kind === "trace" ? sanitizeTrace(data, []) : data,
          );
        }
      }
      check();
      await writePrivate(
        join(dir, "map.json"),
        JSON.stringify(map, null, 2) + "\n",
      );
      await writePrivate(join(dir, "index.html"), renderExplorer(map));
      return { map, paths: this.paths(dir) };
    } catch (error) {
      if (created) await rm(created, { recursive: true, force: true });
      throw error;
    } finally {
      this.busy = false;
    }
  }
  summary(
    map: MapDocument,
    paths: { json: string; html: string },
    workspace = process.cwd(),
    detail = 0,
  ) {
    const location = (file: string) => {
      const value = relative(resolve(workspace), resolve(file))
        .split("\\")
        .join("/");
      if (value.startsWith("..")) throw new MapError("PATH_DENIED");
      return value;
    };
    return {
      mapId: map.mapId,
      sourceRunIds: map.sourceRunIds,
      summary: map.summary,
      firstDivergence: map.comparison?.firstDivergence
        ? safeToken(map.comparison.firstDivergence)
        : undefined,
      warnings: [
        ...new Set(
          map.warnings.map((warning) =>
            [
              "Legacy run: no browser observations; routes and transitions remain unknown.",
              "Observation limits or interrupted scans omitted some browser events.",
              "Routes merge only where an explicit operator route hint matches.",
              "Private or dynamic path segments are redacted; exact route keys remain distinct without a hint.",
              "An extra page was observed and blocked by the one-page policy; its destination is not verified.",
              "A transition absent from an incomplete run is not a deleted application screen.",
            ].includes(warning)
              ? warning
              : "Unrecognized artifact warning omitted.",
          ),
        ),
      ],
      paths: { json: location(paths.json), html: location(paths.html) },
      ...(detail
        ? {
            nodes: map.nodes
              .slice(0, detail)
              .map((n) => ({ id: n.id, kind: n.kind, status: n.status })),
            edges: map.edges.slice(0, detail).map((e) => ({
              id: e.id,
              from: e.from,
              to: e.to,
              status: e.status,
            })),
          }
        : {}),
      truncated:
        detail > 0 && (map.nodes.length > detail || map.edges.length > detail),
      untrustedData: true as const,
    };
  }
}
function safeExcerpt(
  run: RunResult,
  evidence: MapDocument["evidence"],
  name = "legacy-workflow",
): RunResult {
  return {
    ...run,
    name,
    metadata: {
      toolVersion: safeToken(run.metadata.toolVersion),
      nodeVersion: "withheld",
      hostname: "local",
      flowFile: "approved-workflow.yaml",
      checksum: "withheld",
    },
    reproduction: "journeyproof report --run '" + run.id + "'",
    errors: [],
    warnings: [
      "Portable redacted excerpt of actual run evidence; raw page strings and machine metadata are omitted.",
    ],
    steps: run.steps.map((step) => ({
      id: safeToken(step.id),
      action: safeToken(step.action),
      status: step.status,
      durationMs: step.durationMs,
      expected: "Configured " + safeToken(step.action) + " operation",
      observed:
        step.status === "failed"
          ? safeReason(step.reason)
          : step.status === "skipped"
            ? "Not executed"
            : "Operation completed",
      ...(step.reason ? { reason: safeReason(step.reason) } : {}),
      ...(step.screenshot &&
      evidence.some((e) => e.kind === "screenshot" && e.available)
        ? { screenshot: step.screenshot }
        : {}),
    })),
    http: run.http.flatMap((event) => {
      try {
        const url = new URL(event.url);
        const route = routeFor(event.url, url.origin);
        return route
          ? [
              {
                ...event,
                method: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(
                  event.method,
                )
                  ? event.method
                  : "OTHER",
                url: route.path,
              },
            ]
          : [];
      } catch {
        return [];
      }
    }),
  };
}
