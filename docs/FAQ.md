# JourneyProof FAQ

**What does it verify?** Explicitly defined journeys and assertions, with real saved evidence. A successful click or an observed link is not a business assertion. Coverage denominators describe selected declared steps, not entire application, route, code, security or RBAC coverage. Role labels are descriptive.

**CLI, MCP and Skill?** CLI is the executable interface; local stdio MCP exposes eight typed services to a client; Skill supplies host-readable instructions. All use the same core Chromium engine. MCP is not autonomous discovery. SDK tests prove protocol execution; Skill packaging checks do not prove a coding-agent conversation.

**Why Playwright? Why not Playwright MCP?** JourneyProof uses Playwright to execute declared workflows, save sanitized evidence/maps and generate editable assertion-bearing tests. This describes our scope, not a competitor benchmark or endorsement. Current browser is Chromium; unsupported actions and other browser engines are not silently inferred.

**What does an API failure show?** The synthetic broken approval expects HTTP200 and observes500 at the approval step, with minimized trace, masked failure screenshot and report. Later steps are not reached. Healthy and broken run the same generated test bytes.

**Is production safe?** Mutating flows change state and need explicit target authorization. Use disposable synthetic fixtures. MCP/generated execution accepts numeric loopback only. CLI remote use is explicit and is not a grant of permission. There is no general production-safety guarantee.

**Offline and privacy?** Installed local execution/viewing has no telemetry/external AI API or cloud upload. Initial dependencies/browser binaries and registry audits may need network. MCP clients receive bounded sanitized summaries and may forward them according to their own settings. Review host policy, captures and logs; unknown encoded/pixel data can evade masking. Do not upload raw traces or credentials.

**Platforms?** Linux is locally tested; macOS/Windows/hosted matrix configuration is not a passing run. See [compatibility](INSTALLATION.md#compatibility-and-validation-scope). Windows path fixture tests on Linux are not Windows OS validation.

**License/source protection?** Apache-2.0 source license; the source repository is public and npm prerelease `0.1.0-rc.1` is published. The development package is private; future publication and MCP Registry registration require separate authorization. The MCP draft name is `io.github.UsamaTahreemKhalid/journeyproof`; it is not a registration claim. Distributed JavaScript is readable/recoverable even with private Git source; no NDA/minification/license guarantees that copying is impossible. Approval for future publication and third-party dependency legal review remain pending.
