# npm and MCP release preparation

JourneyProof is not yet published on npm or registered in the MCP Registry. The commands under “After publication” are future instructions. Continue to use [source installation](INSTALLATION.md) until publication and independent verification succeed.

## Local release candidate

Run `npm ci`, install Chromium, then `npm run release:artifact`. This builds a private development package, copies its audited files into an isolated directory, writes public release metadata, creates a separate tarball, audits and installs that tarball into an isolated consumer, and writes a file manifest and SHA-512 under `.journeyproof/npm-mcp-release/artifact/`. This is validation, not publication. Run on a clean, reviewed checkout; the command builds from the current working tree. The tarball's npm metadata is `journeyproof@0.1.0-rc.1` and `mcpName` is `io.github.UsamaTahreemKhalid/journeyproof`. Development `package.json` remains private.

The manual `.github/workflows/npm-release.yml` prepares and tests one tarball, publishes its manifest and SHA-512 to the run summary, then transfers that same tarball to a separate staging job. The job requires the protected `npm-release` environment, verifies the recorded owner approval, upstream protected main, exact commit, manifest, package identity and digest, and stages only with OIDC. It never approves the stage. A missing or unverifiable environment, approval, bootstrap, npm trust or registry check fails closed. Normal CI stays validation-only. The owner must review the manifest and digest before approving the environment.

## Owner prerequisites and bootstrap

1. Recheck `npm view journeyproof --registry=https://registry.npmjs.org/` and independently establish npm account ownership; a 404 does not reserve a name. Enable account 2FA and verify the account's package permissions. An owned GitHub account does not establish npm scope ownership.
2. Review source, the candidate tarball and manifest, full CI, licensing, exact version and SHA-512. In GitHub Settings → Environments create `npm-release`, require reviewer `UsamaTahreemKhalid`, select protected branches or a single custom branch rule for `main` (main must be protected), and disable administrator bypass where supported. If the sole maintainer dispatches and reviews the run, do not select prevent self-review. Do not rely on the environment name alone. Do not change existing required checks.
3. npm's staged publishing requires Node 22.14+ and npm 11.15+; JourneyProof itself requires Node 24.11+ within Node 24. Staging a new name creates a **public `0.0.0-stage` placeholder immediately**. The staged release contents remain pending until a maintainer approves with 2FA. The first owner-authenticated stage creates the package; it is a separate explicit release action and claims the name. Do not use OIDC for a nonexistent package or substitute a long-lived automated token. No bootstrap has been performed here.
4. After the package exists, configure npm Trusted Publisher on npmjs.com: provider GitHub Actions; owner `UsamaTahreemKhalid`; repository `journeyproof`; workflow `npm-release.yml`; environment `npm-release`. Allow `npm stage publish`, deny direct `npm publish` and dist-tag management. Verify the saved settings on the package settings page. Use stage-only permissions and restrict traditional token publishing once supported. A new trust configuration expires if its first successful publication is not completed within two days. A working protected staging workflow must exist before relying on this configuration.
5. Only after separately authorizing staging, use an exact previously reviewed artifact and explicit `next` tag; never rebuild after approval. npm stage commands need npm 11.15+. Inspect stage details and download the tarball, compare SHA-512 with the reviewed artifact, and separately approve with 2FA or reject. `npm stage list`, `npm stage view`, `npm stage download` and `npm stage approve` require interactive authentication; OIDC does not authorize these review operations. Duplicate stage/version errors must fail closed.

Illustrative future commands, **do not run during preparation**:

```sh
npm stage publish ./journeyproof-0.1.0-rc.1.tgz --tag next
npm stage list journeyproof
npm stage view <stage-id>
npm stage download <stage-id>
npm stage approve <stage-id>
```

For bootstrap, authenticate interactively to npm as the verified owner, confirm 2FA is enabled and recheck availability. Compare the exact tested tarball against its recorded `sha512sum` before the separately authorized first command. Staging does not approve the version: inspect and compare the downloaded staged tarball, then use a separate 2FA approval or reject it. The workflow stages after its environment approval; it never runs the approval command. A pending stage or published version occupies npm’s same unique version index, and npm rejects duplicate staging. OIDC cannot list pending stages, so the owner must inspect pending stages interactively before dispatch. If the bootstrap already staged this candidate, approve that reviewed stage with separate authorization or reject it; the workflow cannot stage the same version while it is pending or after approval. Before relying on rejection as a route to restaging, independently confirm that the placeholder and ownership remain available.

## After publication

After the owner approves a release and the version appears publicly, run `npm run verify:published` from a reviewed source checkout on Linux with Chromium. It queries the public npm registry for the exact version and `next` tag, checks SHA-512 integrity, downloads and independently installs the tarball, and exercises the CLI, SDK, declarations, MCP tools and synthetic browser demo. It reports any registry attestation metadata but does not cryptographically verify provenance; verify registry signatures and provenance separately before accepting the release.

Future installation in a new consumer:

```sh
npm install journeyproof@0.1.0-rc.1
npx playwright install --with-deps chromium
npx journeyproof doctor
```

`--with-deps` may require system privileges on supported Linux. Playwright 1.64.1's matching Chromium is required; Windows and macOS browser operation has not been validated. CLI help is `npx journeyproof --help`. The SDK is ESM: `import * as journeyproof from "journeyproof"`; testing helpers are available from `journeyproof/testing`. See [CLI](CLI.md), [SDK](SDK.md), [security](SECURITY.md), and [reporting](../SECURITY.md).

For MCP clients, after installation set the command to the installed `journeyproof` executable, arguments to `["mcp"]`, and provide `JOURNEYPROOF_WORKSPACE_ROOT` as an approved absolute application directory and `JOURNEYPROOF_FLOW_ROOT` as an approved workspace-relative flow directory. Set only required application input variables in the host environment. Both settings have defaults; explicitly setting them is recommended. Codex can register the local executable using `codex mcp add journeyproof -- /absolute/path/to/node_modules/.bin/journeyproof mcp`; configure the environment using the host's current MCP configuration. Claude Code supports `claude mcp add --transport stdio --scope user --env JOURNEYPROOF_WORKSPACE_ROOT=/absolute/workspace --env JOURNEYPROOF_FLOW_ROOT=journeys journeyproof -- /absolute/path/to/node_modules/.bin/journeyproof mcp`. Verify host syntax against the current official documentation. See [MCP](MCP.md) for source-based examples and restrictions.

MCP and generated execution accept numeric loopback only; use authorized systems and disposable data. Browser evidence may contain sensitive page content. No HTTP MCP endpoint is offered. Upgrade by selecting and verifying an explicit newer published version and its changelog; rerun your own journey and security review.

After successful npm verification, check the published `mcpName` and ownership, run `mcp-publisher validate .mcp/server.json.example`, then separately authorize GitHub namespace authentication and `mcp-publisher publish .mcp/server.json.example`. Verify the version-specific registry entry. Never run authentication or publication as part of this preparation.

References: [npm staged publishing](https://docs.npmjs.com/staged-publishing/), [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [MCP registry requirements](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/official-registry-requirements.md), [MCP publisher commands](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md).

## Environment and action verification

Before activation, inspect Settings → Environments → `npm-release` and verify required reviewer, protected branches, main protection and bypass settings. An owner can also read `gh api repos/UsamaTahreemKhalid/journeyproof/environments/npm-release` and `gh api repos/UsamaTahreemKhalid/journeyproof/branches/main`. The workflow also reads the environment and run approval history; if read access is unavailable it stops. Reruns are rejected: dispatch a fresh run and reapprove. No environment secrets are needed. Approving requires reviewing that run’s exact commit, manifest and digest in the preparation job summary.

The repository action allowlist must explicitly permit `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` and `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093`, in addition to the existing pinned checkout and setup-node actions. This task changes no GitHub settings. The release-policy audit permits only the exact reviewed workflow digest; any workflow edit requires security review, test updates and a deliberate digest update.
