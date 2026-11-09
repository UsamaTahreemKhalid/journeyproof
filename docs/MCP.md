# Local MCP installation

JourneyProof has an Apache-2.0 source license; npm prerelease `0.1.0-rc.1` is published, while the development package remains private. The MCP draft identity is `io.github.UsamaTahreemKhalid/journeyproof`; MCP Registry registration requires separate owner approval. The private development package.json omits `mcpName`; the published npm artifact contains it. Use a source checkout and Node 24.11+ (24 LTS). Linux is tested; macOS commands below follow the same shell syntax but were not executed. Windows is untested: use absolute Windows paths in host configuration, `node.exe` if needed, and PowerShell environment assignment (`$env:NAME = 'value'`) instead of `export`. No HTTP listener, account, telemetry or paid API is required.

## Three-to-five-minute checkout setup

From the actual repository root (browser dependency downloads may take longer):

```bash
npm ci
npx playwright install --with-deps chromium
npm run build
npm run demo:mcp
```

`demo:mcp` starts fresh healthy/broken fixtures on ephemeral loopback ports, runs the built stdio server with an official SDK client, fetches both reports and leaves synthetic evidence under `.journeyproof/`. It stops all servers afterward. This verifies the eight tools independently of an agent host.

To use a running fixture with an agent, start this in another terminal:

```bash
npm run demo
```

Before starting your agent host, export these **fictional demo-only** values in its terminal:

```bash
export JOURNEY_DEMO_EMAIL=officer@example.test
export JOURNEY_DEMO_PASSWORD=fictional-demo-password
```

The host must pass these variables to its server child. No `.env` files are loaded. A GUI already running may not inherit new exports: restart it from that terminal or configure its environment locally. Never put real credentials in tool arguments or committed host configuration. Restart the fixture before each full journey; approval mutates admission 1.

## Workspace and approved journeys

The entry built from this checkout is **`dist/cli.js`**:

```bash
JOURNEYPROOF_WORKSPACE_ROOT="$PWD" node "$PWD/dist/cli.js" mcp
```

This waits for newline-delimited MCP JSON on stdin; silence is correct. Stdout contains only protocol messages. Errors go to stderr. SIGINT/SIGTERM and protocol disconnection cancel the active run and close Chromium.

`JOURNEYPROOF_WORKSPACE_ROOT` is resolved to a real directory at startup; default is server process cwd. Agent host cwd may differ. Always set an explicit absolute root in host configuration. It can be your application workspace while the executable remains in this checkout.

`JOURNEYPROOF_FLOW_ROOT` is an operator-selected **workspace-relative** approved directory, default `examples/admissions-demo/journeys`. For an application with `journeys/`, set it to `journeys` during registration. The folder may be created later; attempts to use it before it exists fail safely. Tool `flowPath` and `directory` arguments remain relative to the workspace, including the approved folder prefix. Tools cannot change either root. Artifacts always use `<workspace>/.journeyproof/runs`.

Only origins on numeric `127.0.0.1` or `[::1]` are supported through MCP. `localhost`, cloud metadata addresses and all remote targets are rejected, even with `allowRemote: true`. The same mandatory Chromium redirect guard also protects CLI/SDK runs. MCP retains its stricter initial-origin/workspace policy; no tool can disable interception or approve additional origins. Cross-origin resources and popup workflows remain unsupported, Service Workers are blocked, and interception failure stops execution. Security failures use fixed messages and sanitized local evidence; [scope and result codes](SECURITY.md#navigation-and-bounds).

## Codex

Run from this checkout, replacing `journeyproof` with a different name if already configured:

```bash
codex mcp add journeyproof --env JOURNEYPROOF_WORKSPACE_ROOT="$PWD" -- node "$PWD/dist/cli.js" mcp
codex mcp list
codex mcp get journeyproof
```

For another application workspace, use its absolute path in `--env`, add `--env JOURNEYPROOF_FLOW_ROOT=journeys`, and keep the executable's absolute checkout path. The add/list/remove commands were tested against the installed Codex CLI using a temporary unique registration, then removed. This verifies registration, not a model-driven conversation. In a fresh Codex session inspect `/mcp` and confirm the eight `journeyproof_*` tools. Protocol discovery is also proven by `npm run demo:mcp` and `npm run test:mcp`.

Remove with:

```bash
codex mcp remove journeyproof
```

Syntax checked using local `codex mcp add --help`; [official MCP guidance](https://learn.chatgpt.com/docs/extend/mcp).

## Claude Code (documentation-verified; not installed here)

From the checkout, for user scope:

```bash
claude mcp add --transport stdio --scope user --env JOURNEYPROOF_WORKSPACE_ROOT="$PWD" journeyproof -- node "$PWD/dist/cli.js" mcp
claude mcp list
claude mcp get journeyproof
```

Use `--scope project` instead of `--scope user` for `.mcp.json` project configuration. Inspect it before committing; absolute machine paths should normally stay local and secrets must never be committed. Approve trusted project configuration through Claude Code's normal flow. Within Claude Code, `/mcp` shows server status and tools. Remove with `claude mcp remove journeyproof --scope user` (or `--scope project`). These commands follow [current official Claude Code documentation](https://code.claude.com/docs/en/mcp); actual Claude Code registration and skill discovery are untested in this environment.

Equivalent project `.mcp.json` configuration (replace both placeholders):

```json
{
  "mcpServers": {
    "journeyproof": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/checkout/dist/cli.js", "mcp"],
      "env": {
        "JOURNEYPROOF_WORKSPACE_ROOT": "/absolute/application/workspace",
        "JOURNEYPROOF_FLOW_ROOT": "journeys"
      }
    }
  }
}
```

## Verification and troubleshooting

Ask the host to list/validate the selected flow, then run it with `baseUrl: "http://127.0.0.1:4173"`. Fetch the returned run ID using `journeyproof_get_report`. See [exact schemas and example](MCP_TOOLS.md). The [portable skill installation](AGENT_SKILL.md) is a separate step; MCP registration does not install skills.

- No tools: verify the absolute built path, Node version and explicit workspace root; run `npm run demo:mcp` to distinguish server from host issues. Start using `node ... mcp`, never `npm run` as the host command because npm prints stdout banners.
- `PATH_DENIED`: choose a real workspace-relative YAML under the approved folder; symlinks and hidden paths are refused. Configure the intended root at startup.
- `LOCAL_ONLY`: use a numeric loopback origin. There is no remote bypass.
- Doctor browser failure: install Chromium/OS libraries explicitly; doctor itself installs nothing.
- Login failure: supply synthetic values to the server's inherited environment; do not send them as tool arguments. Missing variables return a safe tool error.
- `BUSY`: only one browser operation runs per server. Wait or cancel; do not retry in a loop.
- Run error or missing evidence: inspect local doctor and artifact permissions; no stack trace or raw browser output is sent to the model.

## npm installation and MCP Registry

The npm prerelease `journeyproof@0.1.0-rc.1` is published. Install an explicit version or `journeyproof@next` and use its installed `journeyproof mcp` executable. Avoid unqualified `npx journeyproof`: the `latest` tag currently points to the bootstrap placeholder. The official MCP Registry listing has not yet been submitted. Source-checkout and local-tarball setup are also supported.

## Local tarball executable

The clean tarball test proves `node node_modules/journeyproof/dist/cli.js mcp` with an official SDK stdio client. For agent hosts use the absolute installed JS path and explicit absolute application workspace, retaining the approved relative flow root. Do not substitute a registry npx command. See [tarball setup](INSTALLATION.md).

POSIX example from an installed consumer (inspect existing host settings first). Replace the explicit workspace placeholder with the `workspace` printed by the packaged demo; its approved sample flows actually exist there. The installed executable stays in the parent consumer. An empty consumer directory alone does not contain those sample flows:

```bash
codex mcp add journeyproof --env JOURNEYPROOF_WORKSPACE_ROOT="/absolute/demo/workspace/from/manifest" --env JOURNEYPROOF_FLOW_ROOT=examples/admissions-demo/journeys -- node "$PWD/node_modules/journeyproof/dist/cli.js" mcp
```

This syntax was checked against local Codex help. The documented setup does not claim a new model conversation. The automated SDK check is isolated. For PowerShell use `$env:JOURNEYPROOF_WORKSPACE_ROOT = (Get-Location).Path` and a quoted absolute node.exe/installed JS path; Windows execution remains untested. Claude Code is absent: the documented CLI syntax follows its official documentation and requires manual owner testing. All eight tool contracts and clean protocol stdout are separately tested through the installed server.
