import { it, expect } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseJourney } from "../../src/config/load.js";
import { runJourney } from "../../src/engine/run.js";
import { MapService } from "../../src/map/service.js";
import { observationsSchema } from "../../src/observations/schema.js";
import { ObservationCapture } from "../../src/observations/capture.js";
import { temp } from "../helpers.js";
import type { Page } from "playwright";
it("records real SPA transitions and bounded passive anchors without activating links/forms", async () => {
  const t = await temp();
  let writes = 0;
  let followed = 0;
  const app = createServer((req, res) => {
    if (req.method !== "GET") writes++;
    if (req.url?.startsWith("/write") || req.url?.startsWith("/guide"))
      followed++;
    res.setHeader("content-type", "text/html");
    res.end(
      `<h1>Ready</h1><button onclick="history.pushState({},'', '/students/42?token=do-not-export');document.querySelector('h1').textContent='Student'">Open student</button><form action="/write" method="POST"><button>Danger</button></form><a href="/guide?token=do-not-export">Guide</a><a href="/write">Never follow</a><a href="javascript:alert(1)">No JS</a><a href="data:text/html,test">No data</a><a href="file:///etc/passwd">No file</a><a href="mailto:test@example.test">Mail</a><a href="tel:123">Phone</a><a href="http://169.254.169.254/">No metadata</a><a download href="/download">Download</a><a href="http://[invalid">Bad</a><a style="display:none" href="/hidden">Hidden</a>`,
    );
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const addr = app.address();
  if (!addr || typeof addr === "string") throw Error("No port");
  try {
    const journey = parseJourney(
      JSON.stringify({
        schemaVersion: 1,
        name: "spa-observation",
        role: "observer",
        routeHints: ["/students/:id"],
        steps: [
          { id: "open", action: "goto", path: "/" },
          {
            id: "student",
            action: "click",
            locator: { role: "button", name: "Open student" },
          },
          { id: "assert-url", action: "expectUrl", path: "/students/*" },
        ],
      }),
    );
    const result = await runJourney({
      journey,
      source: { file: "spa.yaml", checksum: "spa" },
      baseUrl: `http://127.0.0.1:${addr.port}`,
      outputDir: t.dir,
    });
    expect(result.run.status).toBe("passed");
    expect(writes).toBe(0);
    expect(followed).toBe(0);
    const obs = observationsSchema.parse(
      JSON.parse(
        await readFile(join(t.dir, result.run.id, "observations.json"), "utf8"),
      ),
    );
    expect(
      obs.events.some(
        (e) => e.type === "navigation" && e.route?.path === "/students/:id",
      ),
    ).toBe(true);
    const serialized = JSON.stringify(obs);
    for (const forbidden of [
      "do-not-export",
      "javascript:",
      "mailto:",
      "/download",
      "/hidden",
      "169.254.169.254",
    ])
      expect(serialized).not.toContain(forbidden);
    const map = await new MapService(t.dir).build([result.run.id]);
    expect(map.map.summary.observedPages).toBe(2);
    expect(map.map.summary.linkedUnvisited).toBe(2);
    expect(
      map.map.nodes
        .filter((n) => n.kind === "page" && n.status === "linked_unvisited")
        .map((n) => n.route)
        .sort(),
    ).toEqual(["/guide", "/write"]);
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
    await t.cleanup();
  }
});
it("honors capture limits, disables scans and masks env/literal values before persistence", async () => {
  const t = await temp();
  try {
    const journey = parseJourney(
      JSON.stringify({
        schemaVersion: 1,
        name: "synthetic-secret",
        observations: {
          maxEvents: 20,
          maxLinks: 0,
          maxLinksPerPage: 0,
          maxBytes: 16384,
        },
        steps: [{ id: "synthetic-secret", action: "goto", path: "/" }],
      }),
    );
    const capture = new ObservationCapture(
      journey,
      "1793730000000-abcd1234",
      "http://127.0.0.1",
      ["synthetic-secret"],
      Date.now(),
    );
    const page = {
      url: () => "http://127.0.0.1/",
      isClosed: () => false,
    } as Page;
    for (let i = 0; i < 30; i++) {
      capture.begin(page, "synthetic-secret");
      await capture.end(page, {
        id: "synthetic-secret",
        action: "goto",
        status: "passed",
        durationMs: 1,
        expected: "",
        observed: "",
      });
    }
    expect(capture.document.events).toHaveLength(20);
    expect(capture.document.truncated).toBe(true);
    expect(JSON.stringify(capture.document)).not.toContain("synthetic-secret");
    const unavailable = {
      ...page,
      evaluate: async () => {
        throw Error("closed");
      },
    } as unknown as Page;
    const enabled = new ObservationCapture(
      { ...journey, observations: undefined },
      "1793730000000-abcd1234",
      "http://127.0.0.1",
      [],
      Date.now(),
    );
    enabled.begin(unavailable, "open");
    await enabled.end(unavailable, {
      id: "open",
      action: "goto",
      status: "passed",
      durationMs: 1,
      expected: "",
      observed: "",
    });
    expect(enabled.document.truncated).toBe(true);
    const limited = parseJourney(
      JSON.stringify({
        schemaVersion: 1,
        name: "limit",
        observations: {
          maxBytes: 16384,
          maxEvents: 1000,
          maxLinks: 1,
          maxLinksPerPage: 30,
          scanIntervalMs: 100,
        },
        steps: Array.from({ length: 100 }, (_, i) => ({
          id: "s" + i,
          action: "goto",
          path: "/" + "x/".repeat(200),
        })),
      }),
    );
    const cap = new ObservationCapture(
      limited,
      "1793730000000-abcd1234",
      "http://127.0.0.1",
      [],
      Date.now(),
    );
    for (let i = 0; i < 1000; i++)
      cap.popup("page-2", "http://127.0.0.1/" + "a/".repeat(200));
    expect(Buffer.byteLength(JSON.stringify(cap.document))).toBeLessThanOrEqual(
      16384,
    );
    expect(cap.document.truncated).toBe(true);
    // A literal token in step metadata is withheld just as env-referenced data is.
    expect(capture.document.declarations[0]!.stepId).toBe("withheld");
  } finally {
    await t.cleanup();
  }
});
