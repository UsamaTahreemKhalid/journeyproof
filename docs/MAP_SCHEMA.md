# Map and observation contracts

[Generated JSON schemas](MAP_SCHEMAS.json) describe `MapDocument` v1 and observations v1. Runtime Zod schemas live in `src/map/schema.ts` and `src/observations/schema.ts`; extra fields and invalid values are rejected. Regenerate with `npm run build && node scripts/export-map-schemas.mjs`. Installed-package smoke compares both exported schemas with these docs, and MCP's separate schema snapshot covers the tool contracts.

Map fields:

| Field                           | Contract                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schemaVersion`                 | Integer 1.                                                                                                                                                                                 |
| `mapId`                         | `map-` plus 20 lowercase hexadecimal characters; content-derived identity.                                                                                                                 |
| `createdAt`, `generatorVersion` | ISO creation time and actual package version.                                                                                                                                              |
| `sourceRunIds`                  | One run ID or a baseline/candidate pair, each `13-digit-timestamp-8hex`.                                                                                                                   |
| `flows`                         | Source run, safe flow ID/name, optional descriptive role, actual status/start time and passed/failed/skipped counts.                                                                       |
| `nodes`                         | <=500 stable page/action IDs, safe title/route, combined observation state, step IDs, sequence, safe details, optional bounded captured HTTP metadata, provenance and evidence references. |
| `edges`                         | <=1500 stable IDs, valid source/target node IDs, navigation/action/sequence/declared/visible-link/blocked-popup kind, state and provenance.                                                |
| `summary`                       | Observed node/edge/page counts, actual passed/failed/not-reached steps, configured step denominator and linked/unvisited pages.                                                            |
| `comparison?`                   | Baseline/candidate IDs, first changed step, outcome changes, added/absent observed navigation IDs and sanitized HTTP-status changes.                                                       |
| `warnings`, `limitations`       | Explicit missing observations, route hint/redaction/scan limits, non-coverage and non-RBAC guarantees.                                                                                     |
| `evidence`                      | Fixed relative `evidence/<RUN_ID>/{report.html,report.json,failure.png,trace.zip}` paths and actual availability.                                                                          |

Every provenance record contains a run ID, optional step ID, stable event/step sequence, optional elapsed time, state, and evidence basis (`step-result`, `browser-navigation`, `step-url`, `visible-anchor`, `flow-declaration`, `legacy-result`, `blocked-popup`). Assertion/failure descriptions use safe reconstructed facts; arbitrary page text/logs never become graph labels. Node HTTP metadata is a bounded subset within observed step start/end times (up to ten responses/run/step, failures first), not payloads or an exhaustive traffic log.

For multiple runs, a combined node prioritizes an observed failure, then passed assertion, unasserted observation, linked, unreached, unknown. Per-run provenance is retained; the viewer recomputes state when filtering. This prevents the baseline from concealing the candidate's unreached step. Page visits themselves remain unasserted. Summary step counts sum actual source results; they do not count deduplicated action nodes as multiple executions.

Observation sidecars contain run ID, safe flow name/fingerprint, optional role, sanitized declared route references, sequence-ordered events, elapsed/end and optional step-start times, before/after routes, page ID, optional popup opener, outcome and truncation flag. Routes store a safe display path, opaque stable key and basis (`hint`, `exact`, `redacted`). No raw query/hash, page title, link label, form value or browser profile is captured. Main-frame events and step URLs record supported SPA URL changes; delayed state after a step can be missed. Unchanged URLs remain action nodes, never invented pages.

## Compatibility and validation

Existing run JSON remains schema v1; observations are a separate optional file. Old runs have no sidecar and map to their known action results with unknown page provenance. They are not silently upgraded into browser observations. A present but corrupt/unknown-version sidecar is an error, not a reason to pretend it was absent. Unknown future run/map versions, mismatched IDs, dangling graph edges, duplicate IDs and invalid provenance fail with safe typed errors.

Graph generation sorts runs/events by stable identifiers and sequence. Declared route merging requires explicit hints; exact routes without hints remain distinct. IDs use SHA-256-derived 80-bit prefixes; these are stable identifiers, **not signatures or proof against a local artifact editor**. The graph's created time is excluded from its content ID. Source run IDs keep evidence associations distinct. Changes to tool generator version/data/availability yield a new map ID; an existing valid identical map is reused. Rebuilding malformed existing artifacts requires removing the affected generated folder explicitly, then building again; the tool will not overwrite suspicious data.

The map service rejects >1 MiB JSON and bounded/invalid binary inputs. Run input reads are <=2 MiB; observations <=256 KiB; screenshots <=4 MiB; trace archives <=12 MiB. Private directories/files retain POSIX 0700/0600 creation modes. Filesystem errors or cancelled builds remove only that build's newly created partial directory. Existing valid maps are never deleted by cancellation.
