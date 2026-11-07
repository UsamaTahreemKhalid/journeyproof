# Journey YAML v1

Root is a strict object with `schemaVersion: 1`, `name` (1–500 chars), optional `baseUrl` (HTTP(S) origin), and 1–100 `steps`. Unknown fields, actions, duplicate keys/IDs, YAML anchors/aliases/tags, input above 128 KiB, oversized strings and invalid timeouts are rejected before launching a browser.

Each step has a unique `id` (1–64 ASCII letters, digits, underscore or hyphen), an `action`, and optional `timeoutMs` (integer 100–30000). The run-wide five-minute ceiling always applies.

| Action           | Required fields                                    | Semantics                                                                                                                                                                            |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `goto`           | `path`                                             | Navigate to an HTTP(S) same-origin path; HTTP 400+ fails.                                                                                                                            |
| `fill`           | `locator`, exactly one of `value` / `valueFromEnv` | Fill a labeled field; value is never part of a report.                                                                                                                               |
| `click`          | `locator`                                          | Click one uniquely matching control.                                                                                                                                                 |
| `expectVisible`  | `locator`                                          | Wait until the uniquely named element is visible.                                                                                                                                    |
| `expectText`     | `locator`, `text`; optional `contains`             | Wait for visibility and matching rendered text. Actual whitespace collapses and trims; expected text is literal. Exact equality by default; `contains: true` uses literal substring. |
| `expectUrl`      | `path`                                             | Wait for the same-origin URL pathname to match.                                                                                                                                      |
| `expectResponse` | `locator`, `method`, `path`, `status`              | Start listening, click the named control, then assert the first matching method/path response's status.                                                                              |

`expectResponse` is the single interaction-plus-response model; it must replace the click that generates that response, not follow it. The status mismatch fails immediately, including a fast HTTP 500. Methods: GET, POST, PUT, PATCH, DELETE. Status: integer 100–599. No response bodies or headers are exported.

```yaml
- id: approve
  action: expectResponse
  locator: { role: button, name: Approve admission }
  method: POST
  path: /api/admissions/*/approve
  status: 200
```

Paths start with `/` and allow ASCII letters/digits, `/`, `_`, `-` and `.`. No query, fragment, percent encoding, backslash, double-leading slash or `.`/`..` segments. URL and response assertions additionally allow at most one `*` per path segment; it matches zero or more characters within that segment. No JavaScript regex is accepted. Pattern matching uses bounded string operations.

Locators: `{role, name}` or `{testId}`, never both. Roles: button, link, textbox, heading, status, alert, combobox, checkbox, radio, dialog, cell, row. Names and test IDs are literal nonempty strings up to 500 chars; matching is exact. For textbox fields, the engine uses their exact accessible label, including labeled password inputs which lack an implicit textbox role. Unnamed status elements can use a test ID. Ambiguous matches fail. CSS and XPath are unavailable.

Fill values are at most 2000 chars. `valueFromEnv` names match `[A-Z_][A-Z0-9_]{0,99}` and must resolve to a nonempty value of at most 2000 chars. Every environment-referenced value is treated as secret regardless of `sensitive`. `sensitive: true` requires `valueFromEnv`. No shell interpolation, script or shell actions are supported. Environment values are resolved into an ephemeral map, never added to the journey/result. `.env` files are not automatically read.

The default origin is `http://127.0.0.1:4173`. Other local defaults allowed: `localhost` and `[::1]`. `--base-url` overrides YAML. Remote origins require `--allow-remote`; credentials, queries, fragments and non-root paths are disallowed in base URLs. Remote consent does not permit additional origins.
