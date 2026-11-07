# Workflow maps

JourneyProof maps **recorded journeys**, not your entire application. The existing runner collects a small sidecar during authorized YAML execution. Building or opening a map is offline and does not launch the target app, follow links or submit forms.

## Five-minute local demo

Use Node 24.11+ within 24 LTS, from this private checkout:

```bash
npm ci
npx playwright install --with-deps chromium
npm run build
npm run demo:map
```

The script starts/stops fresh fictional fixtures on ephemeral numeric-loopback ports, runs the same 15-step admission YAML in healthy and deliberate-500 modes through the built CLI, builds each map and their comparison, and proves MCP/shared-service parity using an official SDK client. It also executes the distinct six-step guidance-review flow using the same fictional officer account and a second **descriptive** role label. No identity or RBAC behavior is invented. Only synthetic credentials/data are used.

The script prints actual run/map IDs and relative locations, and writes `.journeyproof/map-demo/manifest.json`. For automatic browser opening, `npm run demo:map -- --open`. For an actual narrated-by-caption recording, `npm run demo:record`; see [installed demo](REPORTS.md#installed-package-demo). All runtime evidence/media stays ignored and unpublished.

## CLI

```bash
node dist/cli.js map --run <ACTUAL_RUN_ID> --json
node dist/cli.js map --run <ACTUAL_RUN_ID> --open
node dist/cli.js map --compare <BASELINE_RUN_ID> <CANDIDATE_RUN_ID> --open
node dist/cli.js map --run <ACTUAL_RUN_ID> --role admissions-officer --json
```

`--output-dir DIR` selects the existing run root, just as for `run`/`report`; maps live in `DIR/maps/<MAP_ID>/`. IDs are strictly validated. No arbitrary report filenames or filesystem traversal are accepted. Map creation exit **0** means the map was built, even when a source journey failed. Invalid IDs, missing/corrupt artifacts, incompatible comparisons, denied paths/roles, cancellation and infrastructure problems return **2**. Existing `run` exit codes 0/1/2 remain unchanged. Plain output includes map ID, source IDs, paths and an open command; `--json` emits one structured object.

The portable folder contains `index.html`, `map.json`, and `evidence/<RUN_ID>/` with approved redacted run excerpts and available captures. Copy the whole folder for local use. Open `index.html` through `file://`; no Vite server, remote CDN, fonts, account or internet connection is needed. Evidence paths are relative and fixed. `--open` uses the existing Linux/macOS best-effort opener; Windows is untested and can use the printed path manually. Moving only the HTML loses its evidence files, but the embedded graph still works.

## Interpret the graph

| State                    | Meaning                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Observed passed          | A configured assertion actually executed and passed.                                                                             |
| Observed failed          | A configured step executed and failed. Inspector shows a safe actual error category or captured expected/observed HTTP mismatch. |
| Observed, unasserted     | Navigation or a non-asserting action occurred. No business correctness is implied.                                               |
| Linked but unvisited     | A visible same-origin anchor candidate, never followed by passive discovery.                                                     |
| Declared but not reached | A YAML step/target was not reached after failure/interruption.                                                                   |
| Unknown                  | Missing browser observations, blocked popup destination or insufficient evidence.                                                |

Page nodes stay unasserted when visited, even if nearby assertions pass. Action nodes preserve every configured step, including several on the same page and repeated visits. Navigation edges use actual main-frame/step URL evidence. Sequence edges show ordered actions; declared edges are visibly unverified. A visible-link edge records an anchor only: even when another action eventually reaches its destination, the anchor itself is not claimed to have been followed. Blocked popups keep a relationship and unknown destination state; the one-page runner policy is unchanged.

The viewer defaults to essential transitions (navigation, sequence and unverified links); choose **All recorded** to include every action/page association. Search matches page routes, step names and associated step IDs. Run/state filters reveal the candidate's skipped steps even if baseline assertions passed. Role filters use metadata only. Touch/narrow screens start in a node list; the graph supports scrolling/panning, zoom, fit/reset, keyboard buttons and Enter/Space edge selection. Escape closes the evidence inspector and restores selection focus. Light/dark modes are local view state only.

Counters have explicit denominators: configured steps executed / total configured steps across the selected runs, actual failed steps, recorded page visits, and linked/unvisited pages. They are never an application-wide coverage percentage. Node state filters do not rewrite underlying run counts.

## Roles, routes and capture limits

Backwards-compatible optional YAML fields:

```yaml
role: admissions-officer
routeHints:
  - /admissions/:id
observations:
  maxEvents: 400
  maxLinksPerPage: 12
  maxLinks: 60
  maxBytes: 131072
  scanIntervalMs: 250
```

`role` is a lowercase identifier up to 64 characters. It does not authenticate anyone or test permissions. Existing env-based authentication stays unchanged. Route hints are explicit pathname templates with fixed lowercase word segments and optional `:id` segments (max 30 hints, 200 characters each); no regex or executable code. Only matching hints merge dynamic routes. Without a hint, exact pathname keys stay distinct while numeric, encoded, long or private segments are replaced with opaque display segments. Query strings, fragments, credentials and non-HTTP/cross-origin URLs are excluded. Arbitrary path text cannot be guaranteed anonymous; inspect authored metadata and never place credentials in route names.

Limits: events 20–1000 (default 400); links/page 0–30 (12); total unique source/target links 0–100 (60); bytes 16–256 KiB (128 KiB); same-route scan interval 100–2000 ms (250). DOM reads inspect at most 1000 elements per scan. Zero link limits disable passive scanning. Global graph limits are 500 nodes, 1500 edges and 1 MiB JSON. A limit/scan interruption marks observations truncated and produces a warning; no claim of completeness follows. Existing per-step and whole-run deadlines remain in force. Capture is a fixed DOM read, not page-provided JavaScript or an action crawler.

## Comparisons and compatibility

Provide an explicit baseline and candidate of the same flow definition. When both have observations, a definition fingerprint ignores only base URL, descriptive role and capture settings; action IDs/order/conditions and route hints must remain compatible. With legacy artifacts, source checksums and step signatures must match. Different targets/accounts can still produce different outcomes; interpret their context separately. Incompatible flows fail with `INCOMPATIBLE_FLOWS`, rather than fabricating a comparison.

The first divergence is the first changed **configured step outcome**, not the first inferred root cause. Comparison also records added/absent observed navigation transitions and changed HTTP status sequences with sanitized paths. An incomplete failing run's absent transition is never described as a removed screen. Inspect the actual 500 response and screenshot; backend diagnosis needs separate authorized evidence.

Maps reuse stable graph IDs for identical sanitized data. Created time is excluded from graph identity; saved observations preserve sequence/timing. Legacy run reports without observations yield action-only maps, explicit legacy warnings and no invented routes. Corrupt/unknown versions fail safely. See [schema](MAP_SCHEMA.md) and [security model](MAP_SECURITY.md).
