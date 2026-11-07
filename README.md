# JourneyProof

Verify explicit browser journeys with local evidence, observed workflow maps and editable Playwright regression tests. CLI, SDK, local stdio MCP and Skill use one engine.

This is an Apache-2.0-licensed private, unpublished release candidate. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Source licensing does not authorize npm distribution, MCP Registry registration, remote push, artifact upload or a repository visibility change; each remains subject to separate owner approval. External testers:0. No public support SLA, model-host session or Windows/macOS validation is claimed.

![Actual synthetic comparison with masked approval failure](docs/assets/demo-comparison.png)

The image is an inspected historical synthetic run, not a new candidate result or third-party testimonial. Current candidate tests are recorded privately outside this tree.

## Source quickstart

Node >=24.11 <25 and matching Playwright1.64.1/Chromium are required. From this directory:

```bash
npm ci
npx playwright install chromium
npm run demo:installed
```

This audits and installs an actual local tarball outside the source directory, invokes SDK MCP, runs healthy and deliberately broken HTTP500 modes, generates/types/checks the same regression bytes and verifies the offline viewer. It retains printed artifact paths and closes fixtures/browsers. Cold downloads/OS dependencies may take longer than ten minutes. Fedora uses an unofficial Ubuntu browser fallback; other OS/hosted matrix jobs are configured only. Linux may require explicit --with-deps installation with appropriate system privileges.

[Installation](docs/INSTALLATION.md) · [CLI](docs/CLI.md) · [MCP](docs/MCP.md) · [SDK](docs/SDK.md) · [Skill](docs/AGENT_SKILL.md) · [Workflows](docs/WORKFLOWS.md) · [Reports/maps](docs/REPORTS.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [FAQ](docs/FAQ.md).

## Evidence and limits

Seven YAML actions and eight typed MCP tools verify declared assertions, not whole-app/security/RBAC coverage or autonomous root-cause discovery. Unvisited links remain unvisited. Healthy approval passes; broken approval fails with expected200/observed500. A bounded synthetic harness result is not independent human usability evidence.

Default local-first, no telemetry/AI API/upload. MCP client settings may forward summaries to its selected model. Use authorized disposable synthetic apps; MCP/generated execution is numeric-loopback-only. CLI remote use needs explicit target permission. Known-input masking is not universal privacy assurance; inspect captures. Traces omit payload/DOM snapshots. Hard kills and manual retention remain limits.

[Security](SECURITY.md) · [Support](SUPPORT.md) · [Contributing](CONTRIBUTING.md). Source licensing is Apache-2.0; distribution and publication remain owner decisions. A distributed JS archive is inspectable and can be retained/copied.
