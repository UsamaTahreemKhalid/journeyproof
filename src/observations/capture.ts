import { readVisibleAnchors } from "./anchors.js";
import { redact } from "../shared/safety.js";
import type { Page } from "playwright";
import type { Journey } from "../config/schema.js";
import type { StepResult } from "../shared/types.js";
import { digest, routeFor, safeToken, safeName } from "../map/normalize.js";
import {
  observationLimitsSchema,
  type Observations,
  type ObservationEvent,
} from "./schema.js";

export class ObservationCapture {
  readonly document: Observations;
  private readonly limits;
  private sequence = 0;
  private startedAtMs = 0;
  private stepId: string | undefined;
  private before: ReturnType<typeof routeFor>;
  private scans = new Map<string, number>();
  private links = new Set<string>();
  constructor(
    private readonly journey: Journey,
    runId: string,
    private readonly origin: string,
    private readonly secrets: readonly string[],
    private readonly started: number,
  ) {
    this.limits = observationLimitsSchema.parse(journey.observations ?? {});
    const {
      baseUrl: _base,
      role: _role,
      observations: _limits,
      ...definition
    } = journey;
    void _base;
    void _role;
    void _limits;
    this.document = {
      schemaVersion: 1,
      runId,
      flowName: safeName(redact(journey.name, secrets)),
      flowFingerprint: digest(JSON.stringify(definition)),
      ...(journey.role ? { role: journey.role } : {}),
      declarations: journey.steps.map((step) => ({
        stepId: this.safeId(step.id),
        ...(step.action === "goto" || step.action === "expectUrl"
          ? { route: this.route(step.path) }
          : {}),
      })),
      events: [],
      truncated: false,
    };
    for (const declaration of [...this.document.declarations].reverse()) {
      if (
        Buffer.byteLength(JSON.stringify(this.document)) <=
        this.limits.maxBytes / 2
      )
        break;
      delete declaration.route;
      this.document.truncated = true;
    }
  }
  private safeId(value: string) {
    return safeToken(redact(value, this.secrets));
  }
  route(value: string) {
    return routeFor(value, this.origin, this.journey.routeHints, this.secrets);
  }
  private add(event: Omit<ObservationEvent, "seq" | "atMs">) {
    const complete = {
      ...event,
      seq: this.sequence++,
      atMs: Math.max(0, Date.now() - this.started),
    };
    if (
      this.document.events.length >= this.limits.maxEvents ||
      Buffer.byteLength(JSON.stringify(this.document)) +
        Buffer.byteLength(JSON.stringify(complete)) +
        (this.document.events.length ? 1 : 0) >
        this.limits.maxBytes
    ) {
      this.document.truncated = true;
      return;
    }
    this.document.events.push(complete);
    return complete;
  }
  attach(page: Page) {
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        const route = this.route(frame.url());
        if (route)
          this.add({
            type: "navigation",
            pageId: "page-1",
            stepId: this.stepId,
            route,
          });
      }
    });
  }
  popup(pageId: string, url: string) {
    return this.add({
      type: "popup",
      pageId,
      openerPageId: "unknown",
      stepId: this.stepId,
      route: this.route(url),
      outcome: "blocked",
    });
  }
  begin(page: Page, stepId: string) {
    this.startedAtMs = Math.max(0, Date.now() - this.started);
    this.stepId = this.safeId(stepId);
    this.before = this.route(page.url());
  }
  async end(page: Page, result: StepResult) {
    const route = this.route(page.url());
    this.add({
      type: "step",
      startedAtMs: this.startedAtMs,
      pageId: "page-1",
      stepId: this.safeId(result.id),
      before: this.before,
      route,
      outcome: result.status,
    });
    if (!page.isClosed() && route && result.status !== "skipped")
      await this.scan(page, route);
    this.stepId = undefined;
  }
  private async scan(
    page: Page,
    route: NonNullable<ReturnType<typeof routeFor>>,
  ) {
    if (!this.limits.maxLinksPerPage || !this.limits.maxLinks) return;
    const previous = this.scans.get(route.key);
    if (
      previous !== undefined &&
      Date.now() - previous < this.limits.scanIntervalMs
    )
      return;
    this.scans.set(route.key, Date.now());
    try {
      // Fixed, read-only DOM inspection. No labels, forms, inline handlers or page-provided code.
      const hrefs = await page.evaluate(readVisibleAnchors, {
        origin: this.origin,
        maximum: this.limits.maxLinksPerPage,
      });
      for (const href of hrefs) {
        const target = this.route(href);
        if (!target || target.key === route.key) continue;
        const key = route.key + ":" + target.key;
        if (this.links.has(key)) continue;
        if (this.links.size >= this.limits.maxLinks) {
          this.document.truncated = true;
          break;
        }
        this.links.add(key);
        this.add({
          type: "link",
          pageId: "page-1",
          stepId: this.stepId,
          route,
          target,
        });
      }
    } catch {
      this.document.truncated = true;
    }
  }
}
