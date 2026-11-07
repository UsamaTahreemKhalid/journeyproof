# Workflow-map security

The graph is a local evidence view over explicitly authorized journeys. It is not a crawler, authorization scanner, hostile-site sandbox, backend diagnosis engine or application-wide coverage tool. Original MCP execution stays numeric-loopback-only; its remote opt-in remains disabled and the original five tools keep their schemas/semantics.

## Passive capture

Only the existing runner executes YAML actions. Capture observes main-frame navigation, final step URLs, step boundaries, blocked extra pages and visible same-origin navigational anchors on already reached pages. A fixed DOM reader never clicks, submits forms, follows anchors, evaluates page-provided scripts, sends requests or reads form values. It excludes download links, hidden elements, cross-origin targets, credentials and non-HTTP protocols (`file:`, `javascript:`, `data:`, `blob:`, `mailto:`, `tel:`, custom schemes). DOM reads/links/events/bytes are bounded and same-route scans throttled. Actual browser tests prove zero activation/write/danger-link requests caused by passive capture.

## Data minimization

No page/link text, DOM HTML, screenshot pixels, cookies, headers, response bodies, tokens or form values go into the map. Queries/fragments are discarded before persistence; private/numeric/encoded path segments become opaque display keys, and explicit route hints are the only source of template merging. Known env/literal fill values are withheld from observations and all fill values are masked in new failure screenshots. Trace return values are stripped so DOM-reading results are not exported. Flow/step labels are operator-authored identifiers, not harvested page content; inspect them before sharing.

Portable report/JSON evidence is a newly rendered excerpt of actual saved facts using the existing report renderer: safe operation categories, status/counts/timings, numeric HTTP mismatches, sanitized HTTP metadata and fixed evidence links. It omits raw error text, hostname/absolute paths, source basename/checksum and arbitrary assertion literals. The detailed saved run report remains available through the existing `report` command. Legacy runs have no proof of the new screenshot masking, so their screenshot is not copied automatically. Available traces remain local sanitized operation archives; no binary evidence is sent through MCP.

Redaction cannot guarantee anonymity for all operator-authored metadata, arbitrary application content, transformed secrets or image pixels. Unrelated PII may remain in a screenshot despite masking known submitted values. Use synthetic data, inspect captures and never publish evidence automatically. Opaque route hashes are not cryptographic anonymization against dictionary guesses. Old traces may retain data outside the new policy; review before sharing. A connected host may send returned metadata to its model provider; JourneyProof performs no AI/network upload itself.

## Static viewer and injection

The portable viewer is one static HTML with embedded JSON and the same tested browser function. JSON escapes `<`, `>`, `&` and Unicode line separators, so data cannot close its script container. UI strings use textContent/DOM APIs, never untrusted innerHTML or inline event handlers. CSP uses exact SHA-256 script/style hashes with default/connect/object/form/base restrictions and self-only images. No eval, CDN, external font, runtime data fetch or source-application controls exist. Evidence hrefs match a fixed relative-path grammar; screenshots load only after an explicit preview/link action. A removed screenshot displays an accessible rebuild message.

The browser's developer tools can modify an open document; CSP is not a guarantee against a privileged local debugger. Tests intentionally inject malicious strings and an untrusted script element and verify no execution. Graph controls mutate visualization state only. Role labels/green assertions never imply full-page correctness or server-side authorization.

## Filesystem, MCP and limits

MapService is shared by CLI/MCP and never invokes a shell or another runner. Tool arguments accept safe run/map IDs and a role/detail bound, not filenames or arbitrary output roots. Every map/run-root path component is checked for symlinks/canonical resolution, fixed filenames must be bounded regular files, and decoded IDs must match the requested artifact. Maps live under the configured run root's `maps/` directory. The MCP startup workspace/approved-root policy is retained. No arbitrary files, secret paths or browser profiles can be retrieved.

MCP returns <=10 node/edge snippets plus counts/relative paths, no HTML, images, trace data, arbitrary labels or raw artifact warnings. Unknown warning text is withheld; first divergence is a safe step identifier. Data is marked untrusted. Building is annotated as creating local artifacts; reading is read-only. Map builds serialize per service, check cancellation and clean newly created partial output in finally. Existing browser-run limits/cancellation and cleanup remain in effect.

Limits are capture <=1000 events/256 KiB, graph <=500 nodes/1500 edges/1 MiB, run reads <=2 MiB, trace <=12 MiB and screenshot <=4 MiB. Too-large, corrupt, missing and incompatible data returns a typed error. Multiple processes are not globally coordinated; a concurrent same-ID writer can receive BUSY. There is no retention cleanup. Filesystem checks are not race-proof against another local principal able to modify the private workspace; use separate OS accounts/containers for hostile users. Artifacts are not signed and can be forged by a local editor, so provenance identifies its recorded basis, not forensic tamper resistance.
