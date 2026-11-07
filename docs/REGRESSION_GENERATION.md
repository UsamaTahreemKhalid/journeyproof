# Regression generation

JourneyProof translates approved YAML v1 into editable Playwright Test TypeScript. Generation is offline: it does not launch Chromium, resolve inputs, crawl pages or use an AI service. Executing the resulting test is a separate action. Install/build this private checkout first; generated projects also need `@playwright/test` matching the installed Playwright version (currently 1.64.1).

```bash
npm run build
npm run demo:regression
```

The harness executes an actual healthy source journey, generates `tests/generated/admissions-<source-run-id>.spec.ts`, typechecks that exact file, runs it against fresh healthy and broken fixtures, verifies the approval HTTP 500 failure and saves `.journeyproof/regression-demo/manifest.json`. It uses the same commands in CI. Ordinary developer-generated tests are trackable; only these disposable demo filenames are ignored. No generated file is committed as a purported universal test.

## Source and eligibility

```bash
node dist/cli.js generate-test --run ACTUAL_SOURCE_RUN_ID --dry-run --json
node dist/cli.js generate-test --run ACTUAL_SOURCE_RUN_ID --out tests/generated/admissions.spec.ts
node dist/cli.js generate-test --flow examples/admissions-demo/journeys/happy-path.yaml --dry-run
```

`--run` and `--flow` are mutually exclusive. Run mode requires a passed run, exact YAML checksum and ordered step identities, an additive v1 `source.json` link to the current approved YAML, complete matching step observations and unambiguous recorded response evidence for response assertions. An HTTP event must be the only matching method/path event within the step's recorded start/end interval and have the declared status. A background request with identical metadata makes this proof ambiguous and blocks final generation. There is no cryptographic tamper protection: operator-owned artifacts are trusted. Old runs remain readable by reports/maps but must be rerun to acquire source linkage.

Flow mode validates the current definition and labels it `DEFINITION_ONLY`; it does not claim successful execution. Both modes require the final declared step to be an explicit visibility, text or response assertion. A click, fill, navigation or URL assertion alone is insufficient as the final business outcome. The software cannot judge whether an operator's explicit expectation is a useful business requirement. There are no screenshot-derived or invented expectations.

`--draft --out tests/generated/review.draft.md` creates only a visibly NOT VERIFIED, non-executable diagnostic note. It contains no private selectors and cannot be selected as a Playwright spec. Invalid YAML and unknown actions fail schema validation rather than becoming partial executable tests. Exit codes remain 0 command succeeded, 1 executed journey failed, 2 invalid input/environment/ineligible final generation. A requested draft can succeed while remaining ineligible.

## Supported translations

| YAML           | Generated action/assertion                                                             |
| -------------- | -------------------------------------------------------------------------------------- |
| goto           | same-origin `page.goto`, reject HTTP >=400, retry visible body (structural check only) |
| fill           | exact declared locator, `fill` with a required environment input                       |
| click          | exact declared locator, auto-waiting click                                             |
| expectVisible  | `expect(locator).toBeVisible`                                                          |
| expectText     | `toHaveText` / `toContainText`, Playwright whitespace normalization                    |
| expectUrl      | retry `origin` and existing segment-wildcard pathname matcher                          |
| expectResponse | install same-origin method/path wait before click; check declared HTTP status          |

Test IDs use `getByTestId`; textbox names use exact `getByLabel` (including password inputs); other declared roles use exact `getByRole`. Runtime ambiguity is a failure, never resolved with `nth()`. Schema v1 has no select/check/title/value assertions; these remain unsupported. There are no arbitrary selectors, scripts or executable YAML.

## Inputs, privacy and review

All fills, including nonsensitive literals, become environment references. Existing `valueFromEnv` names are retained; literal bindings use `JP_INPUT_<checksum-first-8-uppercase>_<zero-based-step-index>_<STEP_ID_UPPERCASE_WITH_UNDERSCORES>`. A numeric suffix avoids collisions with existing explicit bindings; the ordinal prevents case/dash normalization collisions. The result lists `requiredEnv`; it never includes values or fallback credentials. `JP_BASE_URL` is mandatory at execution and must be a numeric loopback HTTP(S) origin without credentials/query/path. The runtime rejects missing/empty, fewer than three character inputs, and values that are substrings of run-status words because the current evidence redactor cannot safely represent them. Existing engine limits also apply (2000 characters). Known incompatible literals block generation with `UNSUPPORTED_INPUT`. Empty/short fill workflows require manual design rather than claiming support by supplying a different value.

Selectors and assertions that repeat a literal input, contain email addresses or common credential markers block final source emission with `PRIVATE_DEFINITION`. This is conservative detection, not a universal PII classifier. Review other private identifiers in labels/IDs/assertions before generation. Environment values remain external and are never inspected during generation. Source paths are workspace-relative; titles become stable flow hashes. Source strings use JSON literals and script/Unicode escaping, never template/eval insertion. Page text is never consumed as an agent instruction.

In this checkout, a reviewed `tests/generated/admissions.spec.ts` is selected explicitly with:

```bash
JP_SPEC_NAME=admissions.spec.ts npx playwright test --config regression.playwright.config.ts
```

First start a fresh disposable fixture and export `JP_BASE_URL` plus every returned `requiredEnv` binding. Restart stateful fixtures between executions. The default old Playwright config selects `tests/e2e`; the regression config selects `tests/generated`. In another workspace configure its own `testDir`/selection explicitly. The CLI human summary includes the checkout command; generation never executes it. `npm run demo:regression` handles this lifecycle and environment setup automatically for the synthetic fixture.

Review the full written file; a bounded preview can be truncated and must not be copied as an executable file. Edit both the embedded plan and corresponding action/assertion when changing a requirement; the original verified run does not validate developer edits. No automatic application repair occurs.

## One execution engine and IR

The validated serializable `planSchema` is v1, generator v1: source checksum/flow ID/optional run ID, definition/verified mode, normalized journey with stable step IDs, role, environment bindings, ordered assertion/action provenance with observation sequence and response HTTP index, eligibility and bounded diagnostic codes. Unsupported versions, extra fields, embedded origins/literal fills, inconsistent step evidence and eligibility are rejected. The reader does not migrate arbitrary older plans; regenerate from approved YAML. Existing v1 run/map/observation data stays compatible; new runs may include optional `security.code`.

Generated files import `runRegression` from `journeyproof/testing`. They contain direct editable Playwright actions, retrying assertions and named `test.step` callbacks. Generated tests set a 60-second test deadline; the regression runtime stops browser execution after 45 seconds to leave time for cleanup. Longer workflows need explicit engineering changes to both budgets. The existing `runJourney` engine calls these typed callbacks while retaining sole ownership of browser creation, origin guards, cancellation, observations, redaction, screenshot, trace and JSON/HTML reports. The runtime exports no MCP execution tool. A failing callback causes a failed engine report and a failed Playwright test; it is never changed into `test.fail`.

Native Playwright trace/video/screenshot capture is disabled to avoid a second unredacted pipeline. Error messages exposed outside generated callbacks are fixed action diagnostics or numeric HTTP mismatches; raw caught errors are intentionally not attached as causes. TestInfo attaches evidence locations. The existing local report/map links to sanitized operation traces and masked screenshots. Trace DOM replay/network payloads remain intentionally unavailable.

## Writes and confinement

Generation uses the startup `JOURNEYPROOF_WORKSPACE_ROOT` and approved `JOURNEYPROOF_FLOW_ROOT` (default `examples/admissions-demo/journeys`). CLI and MCP share `RegressionService`. For your own local workspace, set the approved flow root before starting the command/server. No target is executed by generation.

Only relative `tests/generated/**/*.spec.ts` or draft `.draft.md` destinations are accepted. Absolute paths, dot traversal, hidden components, backslashes, shell syntax, source-folder writes and any symlink component are rejected. There is a 128 KiB source and generated-output limit, 100 steps, and a 12,000-byte preview. Dry run performs no filesystem writes, including directory creation. Without an output path CLI previews; with one it writes unless `--dry-run` is specified. Identical output is a no-op. A modified existing file requires explicit CLI `--force`; replacement is atomic. New files use atomic create so a concurrent writer is not overwritten. Temp files are private and removed in `finally`. Parent checks assume a trusted local filesystem and cannot prevent an adversarial process racing directory replacement.

MCP defaults to dry-run; writes require `dryRun:false`, `approveWrite:true` and `outPath`. It never exposes force. See [MCP tools](MCP_TOOLS.md). Required file-write approval is supplied through the user's existing authorization where applicable; never infer authorization to overwrite or run against a sensitive environment from generation alone.

The implementation follows the installed APIs and [Playwright locator best practices](https://playwright.dev/docs/best-practices), [retrying assertions](https://playwright.dev/docs/test-assertions), and the reviewable-output approach described by [Playwright's generator](https://playwright.dev/docs/codegen). JourneyProof translates explicit definitions rather than recording arbitrary user actions.

Generated execution inherits the mandatory shared Chromium origin/redirect guard; it cannot disable interception. Only the selected numeric-loopback origin is approved. Same-origin redirects and native POST semantics are preserved; cross-origin document redirects/navigation are blocked before dispatch in tested paths, with destination-server counters proving prevention. Cross-origin resources, popups and Service Workers remain unsupported. Native browser errors/timeouts do not themselves prove isolation. [Scope and security codes](SECURITY.md#navigation-and-bounds).
