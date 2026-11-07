# Interpret observed facts

`passed` means the defined assertions passed for that execution. `failed` means one step failed and remaining steps were skipped. `error` means setup or infrastructure prevented normal execution. Use counts and step IDs, then inspect local HTML/JSON when more detail is needed.

HTTP 500 confirms the captured response status. It does not identify a database, authentication or backend root cause. Explain hypotheses as hypotheses and use source inspection or application logs only when authorized and available.

MCP deliberately omits page text, console errors, raw HTML, headers, cookies, bodies and binary evidence. Its HTTP summary includes failed statuses only and may be truncated. `available: false` means evidence is missing; never fabricate it. Inspect actual files locally if the user requests it. Screenshots can contain application data. Sanitized traces omit DOM, screenshots and network payloads, reducing replay features. No automatic uploads or retention cleanup occur.
