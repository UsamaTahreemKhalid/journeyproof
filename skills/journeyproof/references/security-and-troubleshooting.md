# Permissions and repair

A tool call cannot change the workspace, approved flow root or evidence root. Absolute paths, traversal, symlinks and paths outside the approved journey folder are denied. Do not read `.env`, tokens or browser profiles. Ask the operator to configure the intended approved directory; never bypass a denial by copying secret files into it.

Only HTTP(S) origins on numeric `127.0.0.1` or `[::1]` work through MCP. `localhost` and remote DNS names are rejected to avoid DNS rebinding. Same-origin browser routing is retained. This is not a hostile-site sandbox or a guarantee against all browser egress.

`INVALID_FLOW`: check the YAML v1 schema locally and externally supplied required environment variables. No secret-file loading is supported. `BUSY`: wait for the current journey to finish or cancel it. `UNAVAILABLE`: use doctor, verify browser installation and file permissions, or use a real returned run ID. Doctor suggests `npx playwright install --with-deps chromium`; it never installs packages itself.

MCP request cancellation and process SIGINT/SIGTERM close active browser contexts; an uncatchable kill can leave intermediate evidence. Local users with workspace access can inspect artifacts. Keep synthetic test credentials separate from real accounts.

All four execution interfaces require the shared Chromium origin/redirect guard. A pre-request block is reported explicitly; a timeout, browser error or post-commit denial is not proof of prevention. Do not disable interception or use `--allow-remote` to approve redirect destinations. Popups, cross-origin resources and Service Workers are unsupported. If interception is unavailable, fix the browser environment rather than bypassing the boundary.
