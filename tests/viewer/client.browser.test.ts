import { it, expect, beforeEach, vi } from "vitest";
import { readVisibleAnchors } from "../../src/observations/anchors.js";
import { mountExplorer } from "../../src/viewer/client.js";
import { viewerShell } from "../../src/viewer/shell.js";
import { viewerStyle } from "../../src/viewer/style.js";
import type { MapDocument } from "../../src/map/schema.js";
const a = "1793730000000-abcd1234",
  b = "1793730000001-abcd1234";
function fixture(): MapDocument {
  const evidence: MapDocument["evidence"] = [
    {
      runId: b,
      kind: "screenshot",
      path: `evidence/${b}/failure.png`,
      available: true,
    },
    {
      runId: b,
      kind: "trace",
      path: `evidence/${b}/trace.zip`,
      available: false,
    },
  ];
  return {
    schemaVersion: 1,
    mapId: "map-" + "a".repeat(20),
    createdAt: "2026-11-05T00:00:00.000Z",
    generatorVersion: "0.1.0",
    sourceRunIds: [a, b],
    flows: [
      {
        id: "flow",
        name: "browser-unit-fixture",
        runId: a,
        role: "officer",
        status: "passed",
        startedAt: "2026-11-05T00:00:00.000Z",
        counts: { passed: 2, failed: 0, skipped: 0 },
      },
      {
        id: "flow",
        name: "browser-unit-fixture",
        runId: b,
        role: "reviewer",
        status: "failed",
        startedAt: "2026-11-05T00:00:00.000Z",
        counts: { passed: 1, failed: 1, skipped: 0 },
      },
    ],
    nodes: [
      {
        id: "n-" + "a".repeat(20),
        kind: "page",
        title: "/admissions",
        route: "/admissions",
        status: "observed_unasserted",
        stepIds: [],
        sequence: 0,
        detail: "Page visit only",
        evidence,
        provenance: [
          {
            runId: a,
            sequence: 0,
            status: "observed_unasserted",
            basis: "browser-navigation",
          },
          {
            runId: b,
            sequence: 0,
            status: "observed_unasserted",
            basis: "browser-navigation",
          },
        ],
      },
      {
        id: "n-" + "b".repeat(20),
        kind: "action",
        title: "approve admission",
        route: "/admissions",
        status: "observed_failed",
        stepIds: ["approve"],
        sequence: 1,
        evidence,
        detail: "Expected HTTP 200; observed HTTP 500.",
        http: [{ runId: b, method: "POST", path: "/api/approve", status: 500 }],
        provenance: [
          {
            runId: a,
            stepId: "approve",
            sequence: 1,
            atMs: 50,
            status: "observed_passed",
            basis: "step-result",
            detail: "Configured assertion passed.",
          },
          {
            runId: b,
            stepId: "approve",
            sequence: 1,
            atMs: 60,
            status: "observed_failed",
            basis: "step-result",
            detail: "Expected HTTP 200; observed HTTP 500.",
          },
        ],
      },
    ],
    edges: [
      {
        id: "e-" + "c".repeat(20),
        from: "n-" + "a".repeat(20),
        to: "n-" + "b".repeat(20),
        kind: "action",
        status: "observed_failed",
        provenance: [
          {
            runId: b,
            stepId: "approve",
            sequence: 1,
            status: "observed_failed",
            basis: "step-result",
          },
        ],
      },
    ],
    summary: {
      observedNodes: 2,
      observedEdges: 1,
      observedPages: 1,
      passedSteps: 3,
      failedSteps: 1,
      notReachedSteps: 0,
      linkedUnvisited: 0,
      configuredSteps: 4,
    },
    comparison: {
      baselineRunId: a,
      candidateRunId: b,
      firstDivergence: "approve",
      changes: [{ stepId: "approve", baseline: "passed", candidate: "failed" }],
      addedTransitions: [],
      removedTransitions: [],
      httpChanges: [],
    },
    warnings: ["Unit browser data, not a recorded demo."],
    limitations: ["Role labels do not establish permissions."],
    evidence,
  };
}
const get = (id: string) => document.getElementById(id)!;
const click = (id: string) => (get(id) as HTMLButtonElement).click();
const select = (id: string, value: string) => {
  (get(id) as HTMLSelectElement).value = value;
  get(id).dispatchEvent(new Event("change"));
};
beforeEach(() => {
  document.documentElement.dataset.theme = "dark";
  document.body.innerHTML = viewerShell;
  const style = document.createElement("style");
  style.textContent = viewerStyle;
  document.body.append(style);
});
it("renders actual browser DOM controls, detail provenance and comparison selection", () => {
  mountExplorer(fixture());
  expect(get("flow-name").textContent).toBe("browser unit fixture");
  expect(document.querySelectorAll("#nodes button")).toHaveLength(2);
  click("jump");
  expect(get("details").hidden).toBe(false);
  expect(get("detail-content").textContent).toContain("observed HTTP 500");
  expect(document.activeElement).toBe(get("close-details"));
  expect(get("detail-content").textContent).toContain(
    "Sanitized trace: unavailable",
  );
  click("close-details");
  expect(get("details").hidden).toBe(true);
  (document.querySelector("#nodes button") as HTMLButtonElement).click();
  expect(get("detail-content").textContent).toContain("Page visit only");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(get("details").hidden).toBe(true);
  select("connections", "all");
  const edge = document.querySelector("#edges .transition")!;
  edge.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  expect(get("detail-content").textContent).toContain("action transition");
  edge.dispatchEvent(new MouseEvent("click"));
  expect(get("details").hidden).toBe(false);
  edge.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
});
it("filters runs, descriptive roles, status and search, with honest empty state", () => {
  mountExplorer(fixture());
  select("run", a);
  expect(document.querySelector("#nodes .observed_failed")).toBeNull();
  select("role", "reviewer");
  expect(get("empty").hidden).toBe(false);
  click("reset");
  select("state", "observed_failed");
  expect(document.querySelectorAll("#nodes button")).toHaveLength(1);
  click("reset");
  (get("search") as HTMLInputElement).value = "not present";
  get("search").dispatchEvent(new Event("input"));
  expect(get("empty").hidden).toBe(false);
  click("reset");
  expect(get("empty").hidden).toBe(true);
  expect(get("steps-count").textContent).toBe("4/4");
});
it("supports zoom/fit/reset, graph/list, pan gestures and theme switching", () => {
  mountExplorer(fixture());
  click("reset-view");
  expect(get("zoom").textContent).toBe("100%");
  click("zoom-in");
  expect(get("zoom").textContent).toBe("115%");
  click("zoom-out");
  expect(get("zoom").textContent).toBe("100%");
  click("fit");
  expect(get("zoom").textContent).not.toBe("");
  select("connections", "all");
  const initial = get("graph-area").dataset.view;
  click("view");
  expect(get("graph-area").dataset.view).toBe(
    initial === "graph" ? "list" : "graph",
  );
  click("view");
  expect(get("graph-area").dataset.view).toBe(initial);
  click("theme");
  expect(document.documentElement.dataset.theme).toBe("light");
  click("theme");
  expect(document.documentElement.dataset.theme).toBe("dark");
  const scroller = get("canvas-shell");
  scroller.dispatchEvent(
    new PointerEvent("pointerdown", { clientX: 300, clientY: 200, buttons: 1 }),
  );
  scroller.dispatchEvent(
    new PointerEvent("pointermove", { clientX: 100, clientY: 100, buttons: 1 }),
  );
  scroller.dispatchEvent(new PointerEvent("pointerup"));
});
it("handles unavailable screenshot assets and never executes malicious labels or evidence links", async () => {
  const data = fixture();
  data.nodes[0]!.title = '<img src=x onerror="globalThis.hacked=true">';
  data.evidence.push({ ...data.evidence[0]!, path: "javascript:alert(1)" });
  data.nodes[0]!.evidence = data.evidence;
  mountExplorer(data);
  (document.querySelector("#nodes button") as HTMLButtonElement).click();
  expect(get("detail-content").querySelector("h2")!.textContent).toContain(
    "<img",
  );
  expect(get("detail-content").querySelector("img")).toBeNull();
  expect(
    [...get("detail-content").querySelectorAll("a")].some((a) =>
      a.getAttribute("href")!.startsWith("javascript:"),
    ),
  ).toBe(false);
  const preview = [...get("detail-content").querySelectorAll("button")].find(
    (b) => b.textContent === "Preview screenshot",
  )!;
  preview.click();
  await vi.waitFor(() =>
    expect(get("detail-content").textContent).toContain(
      "Screenshot file is unavailable",
    ),
  );
  expect((globalThis as { hacked?: boolean }).hacked).toBeUndefined();
});
it("shows a safe malformed-data state and supports empty and legacy action-only maps", () => {
  mountExplorer(null);
  expect(get("flow-name").textContent).toBe("Map could not be loaded");
  document.body.innerHTML = viewerShell;
  const empty = fixture();
  empty.nodes = [];
  empty.edges = [];
  empty.comparison = undefined;
  mountExplorer(empty);
  expect(get("empty").hidden).toBe(false);
  document.body.innerHTML = viewerShell;
  const old = fixture();
  old.nodes = [old.nodes[1]!];
  old.nodes[0]!.route = undefined;
  old.edges = [];
  old.comparison!.firstDivergence = undefined;
  old.flows[0]!.role = undefined;
  mountExplorer(old);
  expect(get("jump").hidden).toBe(true);
  expect(document.querySelectorAll("#nodes button")).toHaveLength(1);
});

it("passively reads only visible bounded same-origin anchors without activating any control", () => {
  document.body.innerHTML = `<a href="/safe?token=hidden#fragment">Sensitive label is never returned</a><a download href="/download">Download</a><a style="display:none" href="/hidden">Hidden</a><a style="opacity:0" href="/transparent">Hidden</a><a href="javascript:alert(1)">JS</a><a href="http://[invalid">Bad</a><a href="https://elsewhere.test/">Remote</a><a href="/second">Second</a><form method="POST" action="/write"><button>Never submit</button></form>`;
  let activations = 0;
  for (const element of document.querySelectorAll("a,form"))
    element.addEventListener("click", () => activations++);
  expect(readVisibleAnchors({ origin: location.origin, maximum: 1 })).toEqual([
    "/safe",
  ]);
  expect(readVisibleAnchors({ origin: location.origin, maximum: 10 })).toEqual([
    "/safe",
    "/second",
  ]);
  expect(activations).toBe(0);
});
