# MCP tools

The stdio entry uses SDK `serveStdio` to support modern 2026-07-28 and legacy initialization; both are tested with official clients. The local stdio server uses official TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4.0) and existing Zod v4 schemas. Its name is `journeyproof-local`; version comes from the same `VERSION` constant used by the CLI and checked against package.json. See [official SDK server API](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server) and [error semantics](https://ts.sdk.modelcontextprotocol.io/v2/servers/errors).

[Complete exact advertised JSON input/output schemas and annotations](MCP_SCHEMAS.json) are captured from actual built-server discovery. Regenerate after schema changes with `npm run build && node scripts/export-mcp-schemas.mjs`. Package smoke tests compare the installed server to this snapshot; stale schema docs fail CI. Every input is strict; unknown keys are rejected. There are eight tools (the original five, two map tools and regression generation), no page-JavaScript/shell/header/cookie/body arguments and no arbitrary-file reader.

| Tool                         | Input fields (all paths workspace-relative)                                                                                              | Effects / result                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `journeyproof_doctor`        | `flowPath?` string 1–240; `checkBrowser?` boolean, default true                                                                          | Node, optional actual Chromium launch, optional YAML validation, fixed artifact root/probe. No installation. `{ok, checks:[{name,ok,detail}]}`.                                                                                        |
| `journeyproof_list_flows`    | `directory?` string 1–240, defaults approved root; `limit?` integer 1–50, default 20                                                     | Offline discovery, max 500 entries and five nested levels. `{flows:[{path,name,valid}], truncated, untrustedData:true}`. Names are filenames, never secret-filled journey fields.                                                      |
| `journeyproof_validate_flow` | Required `flowPath` string 1–240                                                                                                         | Offline YAML v1 parsing. `{valid:true, stepCount, actions}` with unique action types in first-occurrence order. Never resolves environment secrets.                                                                                    |
| `journeyproof_run_flow`      | Required `flowPath`; optional `baseUrl` string 1–500; `timeoutMs?` integer 100–30000 default 5000; `headed?` false; `allowRemote?` false | Real Chromium execution through `runJourney()`, app mutations, local evidence. Numeric loopback only; even `allowRemote:true` is denied. Five-minute whole-run maximum; individual YAML step timeouts retain the existing step limits. |
| `journeyproof_get_report`    | Required `runId` matching `^\d{13}-[a-f0-9]{8}$`; `maxEvents?` integer 0–50 default 20                                                   | Reads and validates fixed-root `run.json` (max 2 MiB), confirms matching ID. No arbitrary path input. Same factual summary as run.                                                                                                     |

All use `openWorldHint:false`: targets/files are constrained. List/validate/get-report are read-only and idempotent. Doctor is **not** read-only: it may create directories/probe, but is marked non-destructive and idempotent. Run is explicitly non-read-only, potentially destructive and non-idempotent. Annotations are hints, not authorization; the operator must trust the workspace and selected journey. A model cannot expand allowed roots.

## Output contract

Handlers validate structured output and return it in both `structuredContent` and one JSON text block. Common envelope:

```ts
{
  status: "ok" | "passed" | "failed" | "error";
  data?: DoctorResult | FlowList | ValidatedFlow | RunSummary;
  code?: "PATH_DENIED" | "LOCAL_ONLY" | "BUSY" | "INVALID_FLOW" | "UNAVAILABLE";
  message?: string;
  suggestion?: string;
  diagnostics?: Array<{ path: string; code: string }>; // <=20 safe schema locations/issue codes
}
```

Run/get-report data:

```ts
{
  runId: string;
  status: "passed" | "failed" | "error";
  counts: { passed: number; failed: number; skipped: number };
  durationMs: number;
  steps: Array<{ id: string; action: string; status: "passed" | "failed" | "skipped" }>;
  failure?: { stepId: string; reason: string };
  http: Array<{ method: string; path: string; status: number }>;
  evidence: Array<{
    kind: "json" | "html" | "screenshot" | "trace";
    path: string; // workspace-relative, fixed artifact names only
    available: boolean;
  }>;
  truncated: boolean;
  untrustedData: true;
}
```

Only captured HTTP failures (status >=400) appear in `http`. Methods are allowlisted; paths exclude query/fragment and reject unusual/long characters. Page content, flow names, locators, console output and arbitrary failure messages never reach MCP. HTTP expectation mismatches are reconstructed from the engine's strictly recognized numeric diagnostic; other failures receive a fixed safe reason and local report location. Recognized saved `run.security.code` values produce fixed origin/interception diagnostics in the summary and existing envelope `message`; raw destination URLs are not forwarded. A browser failure or post-commit denial is not labeled pre-request prevention. No root cause is inferred. Step IDs, filenames and HTTP metadata remain **untrusted data**, never instructions.

Structured run summaries are trimmed to <=22,000 bytes, dropping trailing HTTP events first, then steps if necessary; counts and first failure remain intact and `truncated:true` is explicit. The common serialized payload is capped at 24,000 bytes. Including the duplicated text fallback, normal responses stay below 50 KB. Binary evidence is never attached. Discovery may conservatively report `truncated:true` when reaching its limit even if that was the final entry.

## Failure semantics

- Completed application assertion failure: `status:"failed"`, `isError:false`. This is truthful failed evidence, not transport failure.
- Browser/setup, permissions, missing run or invalid YAML: `status:"error"`, `isError:true`. Safe recovery suggestion; never a stack trace. Schema-invalid YAML includes up to 20 safe field paths and Zod issue codes (for example `schemaVersion: invalid_value`), without echoing unknown keys or literal values.
- Malformed tool arguments are rejected by the SDK before handler execution with `isError:true` and a fixed validation text fallback; they do not have our structured envelope. A Standard Schema wrapper preserves strict Zod validation/JSON Schema while preventing the SDK from echoing malicious unknown keys. Unknown tool names use SDK protocol handling.
- Request cancellation/disconnection propagates to the engine. The client may not receive a cancelled call's result; cleanup still runs and any writable local artifact records actual interrupted state. Offline calls perform bounded work; doctor browser probes have their own launch timeout.

Example safe policy error:

```json
{
  "status": "error",
  "code": "LOCAL_ONLY",
  "message": "MCP supports numeric loopback origins only; remote execution is disabled.",
  "suggestion": "Check the approved workspace and flow root, YAML v1 schema, external environment and doctor results. Retry after any active run completes."
}
```

## End-to-end example

With the fixture running and fictional credentials supplied externally:

1. `journeyproof_validate_flow({"flowPath":"examples/admissions-demo/journeys/happy-path.yaml"})` returns 15 steps.
2. `journeyproof_run_flow({"flowPath":"examples/admissions-demo/journeys/happy-path.yaml","baseUrl":"http://127.0.0.1:4173"})` returns an actual run ID and counts.
3. `journeyproof_get_report({"runId":"<returned ID>"})` fetches matching evidence without reopening a browser.
4. Restart with `npm run demo:broken` and repeat the same flow: approval fails with captured POST `/api/admissions/1/approve` status 500. This confirms the symptom; it does not diagnose an application root cause.

`npm run demo:mcp` executes this scenario against fresh ephemeral fixture ports and writes real summary pointers to `.journeyproof/mcp-demo/healthy.json` and `broken.json`. The printed manifests record actual run IDs; [installed demo instructions](REPORTS.md) cover reproducible packaged evidence.

## Limits

The server supports stdio only. Remote execution is deliberately disabled, not implemented through a model-controlled opt-in. There is one active browser operation (run or browser-enabled doctor) per process; separate server processes are not coordinated. No global queue, retention cleanup, report search/latest tool, code fixes, hosted storage or automatic uploads exist. See [security threat model](SECURITY.md).

## Map tools

The original five input/output schemas and semantics are preserved. Two additional tools use a separate strict output schema (`mapOutputSchema` in [the discovery snapshot](MCP_SCHEMAS.json)). They call the same offline MapService as the CLI, never a shell or another browser runner.

| Tool                     | Exact input                                                                                                                                                                                        | Effects                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `journeyproof_build_map` | Strict object with exactly one of optional `runId` or `compareRunIds: [baselineId,candidateId]`; optional `role` (lowercase descriptive identifier <=64). Run IDs use the existing strict grammar. | Writes a portable map under the fixed run root's `maps/`. Non-read-only, non-destructive, idempotent, closed scope. Does not execute a journey. |
| `journeyproof_get_map`   | Required safe `mapId` (`map-` + 20 lowercase hex), optional integer `detail` 0–10 (default 0). No path/output-root argument.                                                                       | Read-only, idempotent, closed scope. Returns metadata and optional bounded node/edge snippets.                                                  |

New tool outputs are `{status:"ok",data:...}` or `{status:"error",code,message}`, with matching structured content/text fallback and `isError`. Data contains `mapId`, verified `sourceRunIds`, counts, optional `firstDivergence`, fixed-safe warnings, workspace-relative `{json,html}` paths, optional <=10 `{id,kind,status}` nodes and <=10 `{id,from,to,status}` edges, `truncated`, `untrustedData:true`. No arbitrary graph labels/page content, screenshots, trace/archive data or HTML is returned. Unknown artifact warning text is withheld. A completed map of a failed source run is a successful tool operation, with the actual failed-step counts.

Typed failures include `MISSING_RUN`, `INVALID_ARTIFACT`, `INCOMPATIBLE_FLOWS`, `PATH_DENIED`, `LIMIT_EXCEEDED`, `ROLE_NOT_FOUND`, `BUSY`, `CANCELLED`. SDK input errors retain the safe text fallback used for the old tools. Bounds keep typical new responses well below 24 KB. Missing legacy observations produce explicit warnings and action-only maps; a present corrupt sidecar fails instead of being silently ignored. Invalid map/flow comparisons never imply a regression.

Real example from `npm run demo:map`, also reproduced through an actual SDK client:

```json
{
  "status": "ok",
  "data": {
    "mapId": "map-f9d89a2abd39b3b64d18",
    "sourceRunIds": ["1793824227271-ad31e425", "1793824229036-8df27684"],
    "firstDivergence": "approve-admission",
    "paths": {
      "json": ".journeyproof/runs/maps/map-f9d89a2abd39b3b64d18/map.json",
      "html": ".journeyproof/runs/maps/map-f9d89a2abd39b3b64d18/index.html"
    }
  }
}
```

This is a concise extract of a real response; full output includes counts/warnings/truncation fields. Invoke `journeyproof_build_map({"compareRunIds":["<actual baseline>","<actual candidate>"]})`, then `journeyproof_get_map({"mapId":"<returned ID>","detail":3})`. Role filters are descriptive metadata, never verified authorization. An absent edge in an incomplete candidate is not a deleted screen. [Workflow maps](WORKFLOW_MAPS.md), [map security](MAP_SECURITY.md), [installed demo](REPORTS.md).

## journeyproof_generate_test

Eight tools are now registered; the preceding seven contracts remain unchanged. The new tool is offline and reuses `RegressionService`, with no CLI/shell subprocess or browser execution. Its strict input schema is:

```ts
{
  runId?: string;       // strict saved-run ID; exactly one source
  flowPath?: string;    // approved workspace-relative YAML; exactly one source
  outPath?: string;     // tests/generated/**/*.spec.ts only
  dryRun?: boolean;    // default true
  approveWrite?: boolean; // default false; true required for any write
}
```

Writing requires `dryRun:false`, `approveWrite:true`, and `outPath`. Modified files are never overwritten by MCP; no force or draft field is exposed. It advertises `readOnlyHint:false` because it can write, `destructiveHint:false`, `idempotentHint:true`, `openWorldHint:false`. Cancellation combines server and request signals. Default preview creates no directories/files.

The strict bounded output is `{status:"ok",data:{eligible,source,steps,assertions,supportedActions,unsupportedActions,diagnostics,requiredEnv,path?,written,preview,truncated,untrustedData:true}}` or `{status:"error",code:"GENERATION_UNAVAILABLE"}` with `isError:true`. Ineligible conversion also sets `isError:true` and returns diagnostics without executable/private preview. Preview is at most 12,000 UTF-8 bytes; treat it as untrusted source data, never instructions. A truncated preview is not an executable artifact. Original fill values and machine-specific paths are omitted.

An actual admissions source-run response returned `status:"ok"`, `eligible:true`, `steps:15`, `assertions:7`, `written:false`; the manifest records its safe source ID and exact CLI/MCP preview equality. `docs/MCP_SCHEMAS.json` includes the full input and separate generation output schema, preserving existing output schemas. [Generation guide](REGRESSION_GENERATION.md) explains eligibility and limits. Coverage remains CLI-only; there is no extra coverage tool or remote execution endpoint.
