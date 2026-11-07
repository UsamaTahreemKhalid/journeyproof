# Reports and observed maps

Run the installed synthetic demo as shown in [installation](INSTALLATION.md). It prints real healthy/broken IDs, report HTML/JSON/minimized traces, masked failure screenshot, comparison HTML and the generated spec path. Open saved HTML locally with its evidence folders intact. HTTP500 is the intended approval failure, not a passing application run.

The included reviewed screenshots are historical synthetic examples, not new snapshot results or real customer data. The viewer is offline/read-only and distinguishes observed assertions, actions, linked-unvisited and unreached states. [WORKFLOW_MAPS.md](WORKFLOW_MAPS.md), [MAP_SCHEMA.md](MAP_SCHEMA.md), [MAP_SECURITY.md](MAP_SECURITY.md). Screenshot privacy still needs review; traces are intentionally minimized.

## Installed package demo

Run `npm run demo:installed` from an authorized checkout after `npm ci` and browser setup, or run `node node_modules/journeyproof/examples/verify-demo.mjs` in a consumer that has the local tarball, matching @playwright/test and Chromium installed. [Exact setup](INSTALLATION.md).

The self-contained entry copies installed fixture assets to a unique isolated workspace, uses the installed CLI/services, executes an actual healthy source journey, emits a substantive spec, and runs the same bytes against fresh healthy and approval-500 fixtures. It checks exit codes 0/1, exact failing business step, trace/PNG/JSON/HTML, coverage and interactive offline comparison. Servers use port 0, health readiness and finally cleanup. No application code is changed. No client/browser state or raw network payloads are uploaded.

The curated README image is [actual comparison PNG](assets/demo-comparison.png); [actual masked failure PNG](assets/demo-failure.png) shows synthetic applicant details obscured and the HTTP 500 alert visible. Both were captured from the installed package, inspected visually and intentionally curated into docs/assets; automatic artifact uploads remain disabled. These images contain no configured synthetic input text in visible form. This does not prove generic screenshots are free of unknown PII.

Initial curated screenshot provenance: source `1793869703160-df49eac7`, healthy `1793869705971-2cb235f9`, broken `1793869708580-60008b58`. Subsequent runs produce different IDs and never overwrite those demo workspaces. The package-smoke manifest in `.journeyproof/package-smoke/manifest.json` identifies the latest verification; default checks delete temp evidence, while `--keep` retains it explicitly.
