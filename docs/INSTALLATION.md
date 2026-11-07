# Installation

No package publication is implied. Node >=24.11 <25 is required. Linux/Fedora with Chromium fallback is actually tested; macOS/Windows and hosted CI remain unverified. Install dependencies/browser binaries from their registries when absent; runtime itself has no telemetry or external AI service.

## A. Existing local source checkout

From its root:

```bash
npm ci
npx playwright install --with-deps chromium
npm run demo:installed
```

The last command builds, audits, packs and installs into a fresh temporary consumer with a path containing spaces, checks runtime-only CLI/MCP, then explicitly installs consumer test dependencies and runs the packaged demo. It prints actual paths and retains the install/tarball/evidence. `.journeyproof/package-smoke/manifest.json` identifies it. Ordinary `npm run test:package` cleans its temporary consumer; `-- --keep` requests retention. The test:package command builds/typechecks independently, so it also works without a prior build.

On this prepared host the complete process is measured in minutes; cold downloads/system dependencies can exceed ten minutes. The goal is usable onboarding, not a guaranteed install-time benchmark. No repository clone command is supplied: the inspected SSH remote does not establish public access.

## B. Owner-supplied tarball

In a new project directory outside the checkout:

```bash
npm init -y
npm pkg set type=module
npm install --ignore-scripts "/absolute/path/journeyproof-0.1.0-rc.1.tgz"
node node_modules/journeyproof/dist/cli.js --version
node node_modules/journeyproof/dist/cli.js --help
node node_modules/journeyproof/dist/cli.js init
node node_modules/journeyproof/dist/cli.js doctor --no-browser
npm install --save-dev --ignore-scripts @playwright/test@1.64.1
node node_modules/playwright/cli.js install chromium
node node_modules/journeyproof/dist/cli.js doctor
node node_modules/journeyproof/examples/verify-demo.mjs
```

Replace the explicit tarball placeholder with your actual owner-supplied path. On Linux with missing system libraries use `node node_modules/playwright/cli.js install --with-deps chromium` (may require administrator privileges). Doctor diagnoses but does not install anything. `--no-browser` verifies Node/workspace/writability only and must not be described as browser readiness. A local npm install creates a CLI shim: `./node_modules/.bin/journeyproof` on POSIX, `node_modules\.bin\journeyproof.cmd` on Windows; the Node entry above is portable.

The demo copies only installed synthetic fixture assets into a unique workspace under your project's ignored `.journeyproof/installed-demo/`. It runs an actual source journey, generates `tests/generated/admissions.spec.ts`, runs that same file healthy/broken, builds real reports/comparison, verifies installed static UI interactions and stops fixture/browser processes. Its own manifest prints `workspace`, source/run IDs and workspace-relative spec/artifact paths. Browser reporter JSON is inspected in memory and not saved. No .env file is read.

To manually select a generated spec in that workspace, use the installed package's `examples/ci/regression.config.mjs`, setting `JP_DEMO_WORKSPACE`, `JP_SPEC_NAME`, `JP_BASE_URL` and returned input bindings. The automated entry handles these safely; do not reuse a mutated fixture without restarting it. Typechecking generated specs additionally requires TypeScript and Node types; the package smoke installs exact development versions and compiles the actual file. These are consumer tools, not hidden CLI runtime dependencies.

## Custom application workflow

Use `init`'s commented `.journeyproof/example.yaml` as a small valid example: it contains navigation plus an explicit visibility assertion. Read [the schema](JOURNEY_SCHEMA.md) before changing it. Run against a target you own and authorize. Supply secrets only through declared environment names. A missing value fails; there is no empty-password fallback.

`run --flow FILE --base-url ORIGIN --json` prints an actual run ID; `report --run ID` validates/rebuilds its HTML; `map --run ID` builds its observed graph. `generate-test --run ID --dry-run` requires verified source linkage. `coverage --flow FILE --runs ID --format table` reports selected-step observations. Custom MCP/generation flows must be below the startup `JOURNEYPROOF_FLOW_ROOT`; CLI's historical run output settings remain separate. Artifacts default to `.journeyproof/runs`; MCP always confines them to the configured workspace.

POSIX environment syntax is `export JOURNEYPROOF_FLOW_ROOT=journeys`; PowerShell uses `$env:JOURNEYPROOF_FLOW_ROOT = 'journeys'`. Set `JOURNEYPROOF_WORKSPACE_ROOT` to the absolute application directory before starting MCP. [MCP installation](MCP.md) and [troubleshooting](TROUBLESHOOTING.md) provide exact distinctions and recovery actions.

## C. Registry distribution — future only

There is no verified public package/name ownership. Do not use bare `npx journeyproof`. Only an explicit owner-approved release could enable a pinned registry installation path; that would need a separate audited artifact, third-party license review, namespace and publishing decision. The current local tarball workflow needs no publishing token or public repository.

## Release kit integrity

Before installing an owner-approved kit, follow its generated VERIFY.md and compare SHA256SUMS.txt through a trusted owner channel. A checksum verifies byte integrity, not publisher identity or distribution rights.

## Compatibility and validation scope

| Environment                                    | Status                    | Evidence/limits                                                                                                                                                         |
| ---------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fedora 44 Linux x64, Node v24.22.0/npm 11.19.1 | tested pass               | full CI, tarball install, native POSIX shim, installed CLI/MCP/generated tests/static viewer; Chromium Ubuntu fallback is unofficial for Fedora                         |
| Node v24.11.0 on this Linux host               | tested pass (lightweight) | actual temporary Node 24.11 binary ran installed CLI, browser-free doctor, package/Skill/export and real stdio MCP checks; browser E2E/build ran under 24.22, not 24.11 |
| Ubuntu GitHub runner, Node 24                  | not tested                | full CI and portability jobs configured; no authorized remote run observed                                                                                              |
| macOS, Node 24.11/24                           | not tested                | lightweight build/pack/doctor-no-browser/MCP jobs configured only                                                                                                       |
| Windows, Node 24.11/24                         | not tested                | same lightweight jobs; Node/file-URL/space-path fixes and Windows path policy tested on Linux are not Windows execution proof                                           |
| Node 22, 24.10, 25, 26                         | not tested, unsupported   | engine range/doctor policy rejects these versions; policy unit tests are not execution on those binaries                                                                |
| Firefox/WebKit                                 | not tested, unsupported   | Chromium only                                                                                                                                                           |
| Codex host registration syntax                 | tested pass               | local `codex mcp add --help`; prior isolated add/get/remove validation; not an actual model conversation                                                                |
| Claude Code host integration                   | not tested                | binary unavailable; syntax checked against official client documentation; SDK protocol tests are separate                                                               |

No dependency upgrades were made. tsup 9 accepts Node ^24.11.0 in this project line, and installed Playwright/Test are both 1.64.1. Generated test execution needs consumer `@playwright/test`; launching installed CLI/MCP does not. No CommonJS entry is promised: this distribution is ESM. Use `pathToFileURL` for absolute dynamic imports and `node` with explicit executable JS paths on Windows rather than spawning .cmd via execFile.

Lightweight platform jobs run `npm run test:platform`; full Linux CI retains browser/security/viewer/generator gates. Portability uses npm's actual JS entry via `npm_execpath`, no shell interpolation. Temp install paths contain spaces. The `.cmd` shim is checked for presence in a future Windows job; actual Windows shell invocation is still unverified. `--open` remains Linux/macOS best-effort; on Windows open the printed HTML manually. POSIX private permission bits have no equivalent ACL guarantee on Windows.

Official browser prerequisites vary by host; check [Playwright installation requirements](https://playwright.dev/docs/intro). macOS/Windows browser runs must be performed before expanding support claims. No retries, skipped tests or coverage exclusions were added for portability.
