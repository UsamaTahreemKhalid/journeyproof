# SDK

The package exports the typed core at journeyproof and generated-test runtime at journeyproof/testing. It uses the same loader/runner/map/generation services as CLI/MCP; no duplicate browser engine.

## From a built source checkout

Follow [source setup](INSTALLATION.md#source-setup), then start a fresh fictional app with `npm run demo`. From the checkout root, execute the [README SDK example](../README.md#sdk) as an ES module on stdin using `node --input-type=module`. Its `./dist/index.js` import resolves the local build; it does not fetch a registry package. Restart the stateful fixture before another complete journey. `runJourney` returns `{ run, paths }`; check status and security diagnostics before claiming a pass. Loading YAML and running the browser are separate operations.

## From npm or a supplied local tarball

After [npm or local tarball installation](INSTALLATION.md), package exports use `journeyproof` and `journeyproof/testing`. This schema-only example executes without a browser:

```javascript
import { journeySchema } from "journeyproof";
const flow = journeySchema.parse({
  schemaVersion: 1,
  name: "Synthetic",
  steps: [{ id: "open", action: "goto", path: "/" }],
});
console.log(flow.schemaVersion);
```

Parsing is definition validation, not execution proof. Use the typed loadJourney/runJourney exports with an authorized target and declared env inputs; inspect installed declarations for exact options. Never print resolved secrets. [Architecture](ARCHITECTURE.md), [schema](JOURNEY_SCHEMA.md), [MCP](MCP.md).

`runJourney` uses the same mandatory Chromium origin/redirect interception as the CLI. `baseUrl` selects one normalized HTTP(S) origin; `allowRemote:true` acknowledges that initial target only. Cross-origin resources/navigation, popup workflows and Service Workers are unsupported. `guardRedirectOrigins` is deprecated: omit it or supply `true`; `false` and invalid values fail before browser launch. Interception unavailability fails closed. Inspect optional `run.security.code` and step reasons in addition to status; a timeout/native browser error is not evidence of egress prevention. Trusted SDK callbacks are arbitrary application code, not sandboxed by this guard. [Security boundary](SECURITY.md#navigation-and-bounds).
