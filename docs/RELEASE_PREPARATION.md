# Staged npm release runbook

`journeyproof@0.1.0-rc.1` is published. `0.1.0-rc.2` is being prepared, not published. The public registry currently has `next` at `0.1.0-rc.1` and `latest` at npm's `0.0.0-stage` bootstrap placeholder. Install the available prerelease with `npm install journeyproof@next` or `npm install journeyproof@0.1.0-rc.1`; do not use an unqualified install until the owner deliberately resolves `latest`. A stable release and promotion to `latest` require a separate policy and owner authorization. No tag changes are made by this preparation.

## Prepare and review

1. Choose a unique exact SemVer version without build metadata, update package.json, package-lock.json, `src/shared/version.ts`, and the version-specific `.mcp/server.json.example` together. Preserve historical release notes. Stable versions are accepted, but this workflow always stages to `next`; promotion requires a separate decision.
2. Review the source, dependencies, license, protected main and exact commit. Use Node 24.11+ within Node 24, npm 11.15+ for staging, and Playwright 1.64.1's matching Chromium. On supported Linux, `npx playwright install --with-deps chromium` may require system privileges. Windows/macOS browser operation has not been validated.
3. Run `CI=true npm run ci`, `npm run test:platform`, `npm run check:release-policy`, and `npm run check:licenses`. Run `npm run release:artifact` from a clean reviewed checkout. This produces `.journeyproof/npm-mcp-release/artifact/journeyproof-<version>.tgz`, `manifest.json`, and `smoke.json`. Review the manifest and compare `sha512sum .journeyproof/npm-mcp-release/artifact/journeyproof-<version>.tgz` with its SHA-512. It installs and exercises the actual artifact in an isolated consumer. The private development package remains unpublished.
4. Check the exact version with `npm view journeyproof@<version> --json --registry=https://registry.npmjs.org/`. A published version must never be reused. Authenticated maintainers must also inspect `npm stage list journeyproof`: OIDC cannot list pending stages. A missing stage from an unauthenticated check is not proof of availability. npm's shared version index rejects duplicates atomically during staging.

## Trusted Publisher and environment

After review and merge, configure npmjs.com → journeyproof → Settings → Trusted Publisher only when the first workflow run is ready. Select GitHub Actions, owner `UsamaTahreemKhalid`, repository `journeyproof`, workflow filename `npm-release.yml`, environment `npm-release`. Permit staging, disallow direct `npm publish` and dist-tag management. Verify the saved values on npmjs.com and restrict traditional token publishing when supported. No permanent CI npm token is needed. Newly configured trust expires if its first successful publication is not completed within two days; if expired or incorrectly configured, remove it and create the corrected configuration only with owner approval. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

In GitHub Settings → Environments → `npm-release`, require reviewer `UsamaTahreemKhalid`, restrict deployments to protected branches or exactly the custom branch `main`, and disable administrator bypass where supported. Main must itself be protected. If the sole maintainer dispatches and reviews, do not enable prevent-self-review. Verify read-only:

```sh
gh api repos/UsamaTahreemKhalid/journeyproof/environments/npm-release
gh api 'repos/UsamaTahreemKhalid/journeyproof/environments/npm-release/deployment-branch-policies?per_page=100'
gh api repos/UsamaTahreemKhalid/journeyproof/branches/main
```

The staging job uses the built-in GitHub token with `actions: read` to verify environment, run approval history and branch state. If access, pagination, reviewer identity, approval or configuration cannot be verified it fails closed. Conflicting or non-owner reviews for the release environment are also rejected; investigate and start a fresh run rather than bypassing this check. No GitHub token is passed to npm. The environment name alone is not sufficient. Reruns are rejected; dispatch and approve a fresh run.

The owner must explicitly allow pinned `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` and `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093` in GitHub action rules alongside the existing checkout/setup-node pins. The release-policy audit accepts only the exact reviewed workflow digest; any edit requires review and a deliberate audit digest update. This task makes no settings changes.

## Stage and review

After separately authorizing staging, dispatch `npm-release.yml` on protected main with the complete reviewed 40-character commit SHA and the exact package version. The preparation job runs full CI, checks version agreement, builds and smokes one tarball, and shows its manifest and SHA-512 in the job summary. Review that exact commit, file list, filename and digest, then approve the protected environment. The staging job downloads that same artifact and rechecks it; it does not rebuild. The workflow uses OIDC and stages to `next`; it neither directly publishes nor approves the stage. Retrieve the stage ID from the Actions output, npmjs.com or an authenticated maintainer CLI:

```sh
npm stage list journeyproof
npm stage view <stage-id>
npm stage download <stage-id>
sha512sum <downloaded-stage-tarball>
```

Confirm the intended version, `staged` status, `next` tag, and SHA-512 equal the reviewed artifact. The stage tag is fixed at staging time. Only after a separate explicit owner decision, use `npm stage approve <stage-id>` and complete npm 2FA. Never put credentials into CI or approve automatically. See [npm staging](https://docs.npmjs.com/staged-publishing/).

## Verify and recover

After approval, check `npm view journeyproof@<version> --json` and `npm view journeyproof dist-tags --json`, then run `npm run verify:published` from the matching reviewed checkout on a supported Linux Chromium host. This downloads the actual public version, verifies registry SHA-512 and runs installed CLI, SDK and MCP smoke tests. Attestation metadata is reported, not cryptographically verified: verify npm signatures and provenance separately when evidence is available. Inspect LICENSE/NOTICE and keep release evidence.

On a staging collision, inspect pending stages interactively; never retry or republish a used version. An incorrect version or checksum blocks approval: preserve evidence and request an owner decision before any rejection or replacement. An approval denial or GitHub API failure requires a fresh dispatch and approval; investigate API permissions/rate limits without bypassing the check. For OIDC mismatch or expired trust, check exact owner/repository/workflow/environment and recreate configuration only after authorization. If a tag is wrong, do not modify it automatically: get a separate owner decision. If a release partially completes, first inspect npm stage and public registry status before deciding on recovery. After independent npm verification, MCP Registry authentication and listing require separate explicit authorization.
