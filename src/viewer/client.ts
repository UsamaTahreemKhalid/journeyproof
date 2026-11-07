import type { MapDocument, MapNode, MapEdge, State } from "../map/schema.js";

// Self-contained so the production renderer can embed this exact compiled function.
// No network, storage, application actions, page-provided code or HTML insertion.
export function mountExplorer(input: unknown) {
  const $ = (id: string) => document.getElementById(id)!;
  const text = (id: string, value: string) => {
    $(id).textContent = value;
  };
  const labels: Record<State, string> = {
    observed_passed: "✓ Assertion passed",
    observed_failed: "! Observed failed",
    observed_unasserted: "● Observed, unasserted",
    linked_unvisited: "↗ Linked but unvisited",
    declared_unreached: "○ Declared but not reached",
    unknown: "? Unknown",
  };
  const priority = [
    "observed_failed",
    "observed_passed",
    "observed_unasserted",
    "linked_unvisited",
    "declared_unreached",
    "unknown",
  ] as State[];
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    content?: string,
  ) => {
    const element = document.createElement(tag);
    if (content !== undefined) element.textContent = content;
    return element;
  };
  let data: MapDocument;
  try {
    data = input as MapDocument;
    if (
      !data ||
      data.schemaVersion !== 1 ||
      !Array.isArray(data.nodes) ||
      data.nodes.length > 500 ||
      !Array.isArray(data.edges) ||
      data.edges.length > 1500 ||
      !Array.isArray(data.flows) ||
      !data.flows.length ||
      !data.nodes.every(
        (n) =>
          typeof n.title === "string" &&
          Array.isArray(n.provenance) &&
          n.status in labels,
      ) ||
      !Array.isArray(data.evidence)
    )
      throw new Error("Invalid map");
  } catch {
    text("flow-name", "Map could not be loaded");
    text(
      "context",
      "Missing or malformed map data. Rebuild with journeyproof map --run <RUN_ID>.",
    );
    $("graph-area").hidden = true;
    return;
  }
  const search = $("search") as HTMLInputElement,
    run = $("run") as HTMLSelectElement,
    role = $("role") as HTMLSelectElement,
    state = $("state") as HTMLSelectElement;
  const area = $("graph-area"),
    canvas = $("canvas"),
    scroller = $("canvas-shell"),
    nodesRoot = $("nodes"),
    edgesRoot = $("edges"),
    listRoot = $("node-list");
  const details = $("details");
  let scale = 1;
  let dimensions = { width: 1200, height: 650 };
  let selected: HTMLElement | undefined;
  area.dataset.view = matchMedia("(max-width:700px)").matches
    ? "list"
    : "graph";
  const option = (select: HTMLSelectElement, value: string, label: string) => {
    const element = make("option", label);
    element.value = value;
    select.append(element);
  };
  for (const [index, flow] of data.flows.entries())
    option(
      run,
      flow.runId,
      `${data.comparison ? (index ? "Candidate" : "Baseline") : "Run"} · ${flow.status} · ${flow.runId.slice(-8)}`,
    );
  for (const value of [
    ...new Set(data.flows.map((flow) => flow.role ?? "unlabelled")),
  ])
    option(role, value, value);
  for (const [key, label] of Object.entries(labels)) option(state, key, label);
  text("flow-name", data.flows[0]!.name.replace(/-/g, " "));
  text(
    "context",
    `${data.sourceRunIds.join(" / ")} · ${data.flows.map((flow) => flow.role ?? "unlabelled").join(" / ")} · ${new Date(data.createdAt).toLocaleString("en-US")}`,
  );
  text(
    "outcome",
    data.flows.map((flow) => flow.status.toUpperCase()).join(" → "),
  );
  text(
    "map-meta",
    `${data.mapId} · Schema ${data.schemaVersion} · JourneyProof ${data.generatorVersion} · Offline static report`,
  );
  for (const warning of [...data.warnings, ...data.limitations])
    $("warnings").append(make("li", warning));
  if (data.comparison) {
    $("comparison").hidden = false;
    text(
      "divergence",
      data.comparison.firstDivergence
        ? `First outcome divergence: ${data.comparison.firstDivergence.replace(/-/g, " ")}`
        : "No configured step outcomes changed.",
    );
    $("jump").hidden = !data.comparison.firstDivergence;
  }
  const allowedRuns = () =>
    new Set(
      data.flows
        .filter(
          (flow) =>
            (!run.value || flow.runId === run.value) &&
            (!role.value || (flow.role ?? "unlabelled") === role.value),
        )
        .map((flow) => flow.runId),
    );
  const statusOf = (item: MapNode | MapEdge): State | undefined => {
    const allowed = allowedRuns();
    const states = item.provenance
      .filter((p) => allowed.has(p.runId))
      .map((p) => p.status);
    return priority.find((status) => states.includes(status));
  };
  function setScale(next: number) {
    scale = Math.max(0.45, Math.min(1.8, next));
    canvas.style.width = dimensions.width * scale + "px";
    canvas.style.height = dimensions.height * scale + "px";
    nodesRoot.style.transform = `scale(${scale})`;
    nodesRoot.style.transformOrigin = "0 0";
    (edgesRoot as unknown as SVGElement).style.width =
      dimensions.width * scale + "px";
    (edgesRoot as unknown as SVGElement).style.height =
      dimensions.height * scale + "px";
    edgesRoot.setAttribute(
      "viewBox",
      `0 0 ${dimensions.width} ${dimensions.height}`,
    );
    text("zoom", `${Math.round(scale * 100)}%`);
  }
  const fit = () => {
    setScale(
      Math.min(
        (scroller.clientWidth - 30) / dimensions.width,
        (scroller.clientHeight - 25) / dimensions.height,
      ),
    );
    scroller.scrollTo(0, 0);
  };
  function showEvidence(item: MapNode | MapEdge) {
    const body = $("detail-content");
    body.replaceChildren();
    const isNode = "kind" in item && "title" in item;
    body.append(
      make(
        "h2",
        isNode
          ? (item as MapNode).title
          : `${(item as MapEdge).kind} transition`,
      ),
    );
    body.append(make("p", labels[statusOf(item) ?? "unknown"]));
    const allowed = allowedRuns();
    if (isNode && (item as MapNode).route)
      body.append(make("p", (item as MapNode).route));
    body.append(make("h3", "Recorded provenance"));
    const timeline = make("ul");
    const entries = item.provenance.filter((p) => allowed.has(p.runId));
    for (const p of entries.slice(0, 20)) {
      const line = make(
        "li",
        `${p.runId} · ${p.stepId ?? "page"} · ${labels[p.status]} · ${p.basis} · sequence ${p.sequence}${p.atMs === undefined ? "" : ` · ${Math.round(p.atMs)} ms`}`,
      );
      if (p.detail) line.append(make("p", p.detail));
      timeline.append(line);
    }
    body.append(timeline);
    if (entries.length > 20)
      body.append(
        make(
          "p",
          "Timeline truncated; the local map JSON contains the remaining provenance.",
        ),
      );
    if (isNode && !entries.some((p) => p.detail))
      body.append(make("p", (item as MapNode).detail));
    if (
      isNode &&
      (item as MapNode).http?.some((event) => allowed.has(event.runId))
    ) {
      body.append(make("h3", "Captured HTTP responses"));
      for (const event of (item as MapNode).http!.filter((event) =>
        allowed.has(event.runId),
      ))
        body.append(
          make(
            "p",
            `${event.method} ${event.path} · HTTP ${event.status} · ${event.runId.slice(-8)}`,
          ),
        );
    }
    body.append(make("h3", "Actual run evidence"));
    const items = (isNode ? (item as MapNode).evidence : data.evidence).filter(
      (e) => allowed.has(e.runId),
    );
    for (const evidence of items) {
      const label = {
        report: "Redacted report",
        json: "Redacted run JSON",
        screenshot: "Failure screenshot",
        trace: "Sanitized trace",
      }[evidence.kind];
      const safe =
        /^evidence\/\d{13}-[a-f0-9]{8}\/(report\.html|report\.json|failure\.png|trace\.zip)$/.test(
          evidence.path,
        );
      if (evidence.available && safe) {
        const link = make("a", `${label} ↗ · ${evidence.runId.slice(-8)}`);
        link.href = evidence.path;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        body.append(link);
        if (evidence.kind === "screenshot") {
          const preview = make("button", "Preview screenshot");
          preview.addEventListener("click", () => {
            const image = make("img");
            image.alt =
              "Actual masked failure screenshot from run " + evidence.runId;
            image.addEventListener("error", () => {
              image.replaceWith(
                make(
                  "p",
                  "Screenshot file is unavailable. Rebuild this map to refresh evidence availability.",
                ),
              );
            });
            image.src = evidence.path;
            preview.replaceWith(image);
          });
          body.append(preview);
        }
      } else {
        const absent = make("span", `${label}: unavailable`);
        absent.className = "evidence-unavailable";
        body.append(absent);
      }
    }
    body.append(
      make(
        "p",
        "Evidence stays local. Review captures before sharing. Missing transitions are not deleted application screens.",
      ),
    );
    details.hidden = false;
    $("close-details").focus({ preventScroll: true });
  }
  const choose = (item: MapNode | MapEdge, element?: HTMLElement) => {
    selected = element;
    showEvidence(item);
  };
  const closeDetails = () => {
    details.hidden = true;
    selected?.focus({ preventScroll: true });
  };
  $("close-details").addEventListener("click", closeDetails);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDetails();
  });
  function draw() {
    details.hidden = true;
    nodesRoot.replaceChildren();
    edgesRoot.replaceChildren();
    listRoot.replaceChildren();
    const shown = data.nodes.filter((node) => {
      const status = statusOf(node);
      return (
        status &&
        (!state.value || status === state.value) &&
        (!search.value ||
          [node.title, node.route ?? "", ...node.stepIds]
            .join(" ")
            .toLowerCase()
            .includes(search.value.toLowerCase()))
      );
    });
    const ids = new Set(shown.map((node) => node.id));
    const pages = data.nodes
      .filter((node) => node.kind === "page")
      .sort(
        (a, b) =>
          Number(a.status === "linked_unvisited") -
            Number(b.status === "linked_unvisited") || a.sequence - b.sequence,
      );
    const columns = new Map(pages.map((node, index) => [node.route, index]));
    if (!columns.size) columns.set(undefined, 0);
    const rows = new Map<number, number>();
    const positions = new Map<string, { x: number; y: number }>();
    const changed = new Set(
      data.comparison?.changes.map((change) => change.stepId) ?? [],
    );
    for (const node of data.nodes) {
      const column = columns.get(node.route) ?? 0;
      const row = node.kind === "page" ? 0 : (rows.get(column) ?? 0) + 1;
      if (node.kind === "action") rows.set(column, row);
      positions.set(node.id, { x: 35 + column * 265, y: 30 + row * 112 });
    }
    dimensions = {
      width: Math.max(600, columns.size * 265 + 40),
      height: Math.max(420, ...[...positions.values()].map((p) => p.y + 120)),
    };
    const svg = (tag: string) =>
      document.createElementNS("http://www.w3.org/2000/svg", tag);
    const defs = svg("defs"),
      marker = svg("marker"),
      arrow = svg("path");
    marker.id = "arrow";
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("orient", "auto-start-reverse");
    arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    marker.append(arrow);
    defs.append(marker);
    edgesRoot.append(defs);
    for (const edge of data.edges) {
      const status = statusOf(edge);
      if (
        !ids.has(edge.from) ||
        !ids.has(edge.to) ||
        !status ||
        (($("connections") as HTMLSelectElement).value === "workflow" &&
          edge.kind === "action")
      )
        continue;
      const from = positions.get(edge.from)!,
        to = positions.get(edge.to)!;
      const path = svg("path");
      const x1 = from.x + 109,
        y1 = from.y + 85,
        x2 = to.x + 109,
        y2 = to.y;
      const bend = Math.max(25, Math.abs(y2 - y1) / 2);
      path.setAttribute(
        "d",
        `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`,
      );
      path.setAttribute("class", `transition ${edge.kind} ${status}`);
      path.setAttribute("marker-end", "url(#arrow)");
      path.setAttribute("tabindex", "0");
      path.setAttribute("role", "button");
      path.setAttribute(
        "aria-label",
        `${edge.kind} transition: ${labels[status]}`,
      );
      path.addEventListener("click", () =>
        choose(edge, path as unknown as HTMLElement),
      );
      path.addEventListener("keydown", (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === "Enter" || key === " ") {
          event.preventDefault();
          choose(edge, path as unknown as HTMLElement);
        }
      });
      edgesRoot.append(path);
    }
    const buttonFor = (node: MapNode) => {
      const status = statusOf(node)!;
      const button = make("button");
      button.className = `graph-node ${node.kind} ${status}${node.stepIds.some((id) => changed.has(id)) && node.kind === "action" ? " changed" : ""}`;
      button.dataset.nodeId = node.id;
      button.setAttribute("aria-label", `${node.title} · ${labels[status]}`);
      button.append(
        make(
          "small",
          node.kind === "page"
            ? "PAGE OBSERVATION"
            : `STEP ${node.sequence + 1} · ${node.provenance[0]?.stepId ?? "action"}`,
        ),
        make("strong", node.title),
      );
      const badge = make("span", labels[status]);
      badge.className = "badge " + status;
      button.append(badge);
      button.addEventListener("click", () => choose(node, button));
      return button;
    };
    for (const node of shown) {
      const position = positions.get(node.id)!;
      const button = buttonFor(node);
      button.style.left = position.x + "px";
      button.style.top = position.y + "px";
      nodesRoot.append(button);
      const holder = make("div");
      holder.className = "list-node";
      holder.append(buttonFor(node));
      listRoot.append(holder);
    }
    text(
      "empty",
      data.nodes.length
        ? "No matching observations. Reset filters to see the recorded workflow."
        : "No graph observations are available for these runs. Execute a defined journey, then rebuild the map.",
    );
    $("empty").hidden = shown.length > 0;
    scroller.hidden = !shown.length;
    text(
      "visible-count",
      `${shown.length} nodes · ${data.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).length} recorded transitions · read-only`,
    );
    const allowed = allowedRuns();
    const flows = data.flows.filter((flow) => allowed.has(flow.runId));
    const executed = flows.reduce(
        (count, flow) => count + flow.counts.passed + flow.counts.failed,
        0,
      ),
      configured = flows.reduce(
        (count, flow) =>
          count + flow.counts.passed + flow.counts.failed + flow.counts.skipped,
        0,
      );
    text(
      "pages-count",
      String(
        pages.filter((node) => statusOf(node)?.startsWith("observed_")).length,
      ),
    );
    text("steps-count", `${executed}/${configured}`);
    text(
      "failed-count",
      String(flows.reduce((count, flow) => count + flow.counts.failed, 0)),
    );
    text(
      "links-count",
      String(
        pages.filter((node) => statusOf(node) === "linked_unvisited").length,
      ),
    );
    text("view", area.dataset.view === "graph" ? "Show list" : "Show graph");
    setScale(scale);
  }
  for (const control of [run, role, state, $("connections")])
    control.addEventListener("change", draw);
  search.addEventListener("input", draw);
  $("reset").addEventListener("click", () => {
    search.value = run.value = role.value = state.value = "";
    draw();
  });
  $("view").addEventListener("click", () => {
    area.dataset.view = area.dataset.view === "graph" ? "list" : "graph";
    draw();
  });
  $("theme").addEventListener("click", () => {
    const light = document.documentElement.dataset.theme !== "light";
    document.documentElement.dataset.theme = light ? "light" : "dark";
    text("theme", light ? "Dark mode" : "Light mode");
  });
  $("zoom-in").addEventListener("click", () => setScale(scale + 0.15));
  $("zoom-out").addEventListener("click", () => setScale(scale - 0.15));
  $("fit").addEventListener("click", fit);
  $("reset-view").addEventListener("click", () => {
    setScale(1);
    scroller.scrollTo(0, 0);
  });
  $("jump").addEventListener("click", () => {
    search.value = run.value = role.value = state.value = "";
    draw();
    const node = data.nodes.find(
      (n) =>
        n.kind === "action" &&
        n.stepIds.includes(data.comparison!.firstDivergence!),
    );
    if (node) choose(node, $("jump"));
  });
  let drag: { x: number; y: number; left: number; top: number } | undefined;
  scroller.addEventListener("pointerdown", (event) => {
    if (
      event.target === scroller ||
      event.target === canvas ||
      event.target === edgesRoot
    ) {
      drag = {
        x: event.clientX,
        y: event.clientY,
        left: scroller.scrollLeft,
        top: scroller.scrollTop,
      };
    }
  });
  scroller.addEventListener("pointermove", (event) => {
    if (drag && event.buttons)
      scroller.scrollTo(
        drag.left - event.clientX + drag.x,
        drag.top - event.clientY + drag.y,
      );
  });
  scroller.addEventListener("pointerup", () => {
    drag = undefined;
  });
  draw();
  if (area.dataset.view === "graph") fit();
}
