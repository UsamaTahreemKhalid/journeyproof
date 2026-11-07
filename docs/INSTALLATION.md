# Installation

JourneyProof `0.1.0-rc.1` is an Apache-2.0-licensed source release candidate. The npm package is private and unpublished; MCP Registry installation is unavailable. Use source or an explicitly supplied local tarball. Do not run bare `npx journeyproof` or assume a registry package belongs to this project.

## Source setup

Requires Node.js **24.11+ within Node 24**, npm and matching Playwright **1.64.1 / Chromium**. Examples use a POSIX shell.

```bash
git clone https://github.com/UsamaTahreemKhalid/journeyproof.git
cd journeyproof
npm ci
npx playwright install chromium
npm run build
node dist/cli.js doctor
```

Cloning requires repository access until the owner makes the source public. Existing checkouts/source archives start at `npm ci` in the project root. `npm ci` uses the lockfile; do not substitute dependency upgrades. Initial package/browser downloads require network access and may take several minutes. The application runtime needs no external AI API or account.

On a supported Linux distribution with missing OS libraries, use `npx playwright install --with-deps chromium` with the required system privileges. Other distributions may use Playwright's unofficial browser fallback; this is not an assurance of OS support. Doctor reports readiness but installs nothing. `doctor --no-browser` checks Node/workspace/writability only, not browser readiness. Browser versions must match the locked Playwright dependency.

## Short local demo

After setup:

```bash
npm run demo:map
```

Allow about 60 seconds on a prepared machine; this is not a timing guarantee. The command owns fresh healthy, deliberately HTTP-500-broken and reviewer fixtures on ephemeral numeric-loopback ports, supplies fictional inputs, runs the actual CLI/MCP map workflow and closes its resources. Its exit code is zero only when the expected outcomes and checks pass. It does not contact an external application or install anything.

Open the final comparison HTML path printed by the command. `.journeyproof/map-demo/manifest.json` records the healthy/broken run IDs and comparison path; `.journeyproof/map-demo/screenshots/` contains real viewer captures. Offline HTML opens directly from disk. Run evidence lives under ignored `.journeyproof/`; review screenshots before sharing and remove old evidence manually when no longer needed.

The [README](../README.md#cli) provides a manual CLI journey and SDK example. Restart the fictional server before each complete journey: approval and admission creation mutate its in-memory state. The short demo does this automatically. Fixed port 4173 is used only by the manual `npm run demo` command; stop it with Ctrl+C. If occupied, stop your own fixture or use a reviewed alternate port and matching base URL.

## Interface setup

- [CLI](CLI.md): run the built source entry with `node dist/cli.js`; use `--help` or `COMMAND --help`. Exit 1 is a failed journey; exit 2 is an input/environment error.
- [SDK](SDK.md): source examples import `./dist/index.js` from the checkout root. The distribution is ESM; no CommonJS entry is promised.
- [MCP](MCP.md): register the absolute built Node entry, choose an explicit absolute workspace and approved relative flow root, and pass only declared input variables. `npm run demo:mcp` verifies protocol execution independently of a model host.
- [Agent Skill](AGENT_SKILL.md): copy the whole Skill directory into a supported host discovery location. Bundling or MCP registration does not install it.
- [Regression generation](REGRESSION_GENERATION.md): preview before writing; generated execution needs matching Playwright Test, included among source development dependencies. `npm run demo:regression` exercises the complete synthetic lifecycle.

All browser paths require the shared Chromium guard. There is one approved origin and no cross-origin resource/API/navigation allowlist. Popups, WebSockets and Service Workers are unsupported. MCP/generated execution accepts numeric loopback only. Read [security and compatibility](SECURITY.md#navigation-and-bounds) before choosing your application.

## Windows shell guidance

The Node commands above use the same executable paths with forward slashes. In PowerShell, replace POSIX environment assignments with `$env:JOURNEY_DEMO_EMAIL = 'officer@example.test'` and `$env:JOURNEY_DEMO_PASSWORD = 'fictional-demo-password'`. Use `$env:JOURNEYPROOF_WORKSPACE_ROOT = (Get-Location).Path` for a checkout workspace. Resolve absolute executable paths explicitly in host configuration.

To copy the Skill, first verify that the destination is absent, then use `New-Item -ItemType Directory -Force .agents/skills` and `Copy-Item -Recurse skills/journeyproof .agents/skills/journeyproof`. The source scripts use Node APIs for portable subprocesses; the README's `export`, `test`, `cp` and `RUN_ID=$(...)` snippets require POSIX syntax. In PowerShell, read an ID with `$runId = (Get-Content .journeyproof/map-demo/manifest.json -Raw | ConvertFrom-Json).healthy.runId`, then use `--run $runId`. Open printed HTML paths manually; automatic `--open` is Linux/macOS best effort.

These are shell adaptations, not evidence of an actual Windows browser run. See validation scope below.

## Full local distribution check

```bash
npm run demo:installed
```

This builds/typechecks, audits the package, installs the actual tarball into a fresh temporary consumer with a space-containing path, and checks the runtime-only CLI, SDK exports, Skill, stdio MCP, generated tests and offline viewer. It retains the consumer/tarball/evidence and prints actual paths; `.journeyproof/package-smoke/manifest.json` records the result. Ordinary `npm run test:package` performs the same check and cleans its temporary consumer. This longer check is separate from the short demo and may take minutes.

## Owner-supplied local tarball

This is an alternative for an explicitly supplied artifact, not a public download claim. Replace the absolute tarball placeholder with its actual reviewed path. In a new project outside the checkout:

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

The packaged demo copies only fictional fixture assets into a unique workspace under your project's `.journeyproof/installed-demo/`, runs the same generated spec against healthy/broken fixtures and prints a manifest. Ensure that `.journeyproof/` is ignored in your consumer project. It loads no `.env` file. Typechecking generated specs additionally needs TypeScript/Node types; full package smoke installs those explicitly. CLI/MCP runtime does not need consumer Playwright Test.

If provided a release kit, compare SHA256SUMS.txt through a trusted owner channel and follow VERIFY.md. Checksums establish byte integrity, not publisher identity, rights or publication approval.

## Your own application

Use `node dist/cli.js init` for a commented `.journeyproof/example.yaml`, then read the [journey schema](JOURNEY_SCHEMA.md). Choose only authorized targets with disposable data and explicitly declared environment inputs. Missing inputs fail; no empty-password fallback exists.

Run output defaults to `.journeyproof/runs`; `report --run ID` rebuilds HTML and `map --run ID` builds an observed graph. Use actual returned IDs. Custom MCP/generation flows must be under the operator-selected startup `JOURNEYPROOF_FLOW_ROOT`, relative to the canonical workspace. See [MCP workspace setup](MCP.md#workspace-and-approved-journeys). Historical CLI output flags do not grant MCP filesystem access.

## Compatibility and validation scope

| Environment                                | Scope                                                                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux, Node 24.22, matching Chromium       | Locally exercised full CI, browser journeys, viewer and installed tarball. Fedora's Ubuntu browser fallback is unofficial; use a Playwright-supported OS for its supported prerequisites. |
| Node 24.11 on Linux                        | Earlier lightweight installed CLI/doctor-no-browser/export/Skill/stdio checks; not equivalent to a fresh full browser/build run on that patch.                                            |
| Ubuntu hosted CI, Node 24                  | Configured for full CI; a local pass does not establish a new hosted pass.                                                                                                                |
| macOS/Windows, Node 24.11/24               | Lightweight portability jobs configured; this documentation update does not claim execution on either OS or browser readiness there.                                                      |
| Node 22, 24.10, 25 or later major versions | Unsupported by the current engine range/doctor policy.                                                                                                                                    |
| Firefox/WebKit                             | Unsupported: the mandatory guard requires Chromium CDP interception.                                                                                                                      |
| Codex/Claude Code model sessions           | Protocol, Skill files and copy behavior are tested separately from an actual model session; host discovery/behavior needs host-specific verification.                                     |

`npm run ci` retains browser/security/viewer/generator and package gates. `npm run test:platform` runs lightweight path/Skill/distribution tests and browser-free installed checks. Windows-path unit tests on Linux do not prove Windows execution. POSIX permission bits do not promise Windows ACL confinement.

See [Playwright prerequisites](https://playwright.dev/docs/intro), [troubleshooting](TROUBLESHOOTING.md), [support](../SUPPORT.md) and [private vulnerability reporting](../SECURITY.md). Source visibility, npm publication and MCP Registry registration remain separate owner decisions; no setup command authorizes them.
