# SDK

The package exports the typed core at journeyproof and generated-test runtime at journeyproof/testing. It uses the same loader/runner/map/generation services as CLI/MCP; no duplicate browser engine.

After approved local installation this schema-only example executes without a browser:

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
