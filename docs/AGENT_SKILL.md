# Portable JourneyProof Agent Skill

The bundled [SKILL.md](../skills/journeyproof/SKILL.md) follows the [Agent Skills specification](https://agentskills.io/specification): a directory matching `name: journeyproof`, required description, compact Markdown workflow, and relative references/assets. It contains no credentials, scripts, host-specific tool allowlist, license change or automatic production-fix permission.

`skills/journeyproof/` is included in the private local tarball. Bundling does **not** make an arbitrary `skills/` folder discoverable by Codex or Claude Code. Install explicitly in a supported discovery location. Copy rather than link for a self-contained portable install; the copied references must accompany SKILL.md. Do not overwrite an existing skill without reviewing it.

## Codex project installation

From the checkout root, after confirming the destination does not already exist:

```bash
mkdir -p .agents/skills
test ! -e .agents/skills/journeyproof && cp -R skills/journeyproof .agents/skills/journeyproof
```

Restart Codex in this project, inspect `/skills`, then invoke `$journeyproof` or ask to verify an explicitly selected journey. Personal installation uses `~/.agents/skills/journeyproof/` instead. These paths are verified against [official current Codex skill discovery documentation](https://learn.chatgpt.com/docs/build-skills). The copy operation and reference integrity are tested in temporary project directories; a fresh Codex model session's skill selection was not exercised.

## Claude Code project installation

```bash
mkdir -p .claude/skills
test ! -e .claude/skills/journeyproof && cp -R skills/journeyproof .claude/skills/journeyproof
```

Personal installation uses `~/.claude/skills/journeyproof/`. Start Claude Code at the project root and invoke `/journeyproof`, or describe a relevant test task. Paths and syntax follow [official Claude Code skill documentation](https://code.claude.com/docs/en/skills). File installation is tested in a temporary directory; actual host discovery is untested because Claude Code is unavailable here. No global skill or persistent agent registration was installed as part of implementation.

To remove an installation, remove only the `journeyproof` directory you copied after verifying its location. Repository source remains `skills/journeyproof/`.

## Validation

Executed successfully:

```bash
uv tool run --from 'git+https://github.com/agentskills/agentskills.git@69ef37e9424c0a7ea9dd2293b559e43ec8176379#subdirectory=skills-ref' skills-ref validate ./skills/journeyproof
npm run test:skill
```

The official validator reports `Valid skill: skills/journeyproof`. The local CI suite validates frontmatter constraints, directory/name alignment, required resources, relative references after copy, package inclusion, and real CLI fallback parsing. It does not require network access or Python in CI. The skill-creator quick validator also passed.

## Use and boundaries

See [example prompts](../skills/journeyproof/assets/example-prompts.md). The skill establishes an actual selected flow and authorized target, uses doctor/list/validate, runs once, fetches factual evidence and reports counts/failing step. It separates symptoms, hypotheses and unknowns. HTTP 500 alone is not a diagnosis. A repair requires authorized source changes and a subsequent green rerun of the **same** journey.

MCP registration is separate: [installation](MCP.md). If MCP is absent, the skill may use verified CLI commands and must say which interface it used. It must not claim a run if neither interface exists. Credentials stay in externally supplied environment variables; secret files, guessed endpoints, fabricated screenshots, remote bypasses, automatic production changes and unsolicited evidence uploads are prohibited.

## Map interpretation

The skill now uses `journeyproof_build_map` / `journeyproof_get_map` (or the exact CLI `map` fallback) after real runs, interprets all six provenance states and can compare a compatible baseline/candidate. It explicitly prohibits application-wide coverage claims, inferred screen deletion and treating role labels as verified RBAC. Read [the focused map reference](../skills/journeyproof/references/workflow-maps.md). Existing secret handling, authorization and repair/rerun rules remain intact. Bundling still does not install the skill globally; supported host locations are unchanged.

The Skill includes [portable regression guidance](../skills/journeyproof/references/regression-tests.md). Agents validate/run first, preview a linked verified run through `journeyproof_generate_test`, obtain any required write/overwrite authorization, and separately execute against the selected disposable numeric-loopback fixture before claiming success. The new tool defaults to preview and cannot force overwrite. Drafts never enter CI. The CLI coverage fallback reports explicit-assertion denominators and unknown legacy observations. Existing user authorization applies; the skill does not create repetitive approval loops for already authorized work.

## Installed package

The tarball's self-contained skill is `node_modules/journeyproof/skills/journeyproof`. Copy that directory explicitly into the chosen host directory using `cp -R` (POSIX) or `Copy-Item -Recurse` (PowerShell); no automatic global installation occurs. The clean package check validates actual installed frontmatter, name/description bounds, compact instructions and every local reference. Actual host discovery remains a separate manual check. [Installed onboarding](INSTALLATION.md).
