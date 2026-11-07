# Local workflow

Select an existing YAML flow under the server's approved flow root. The default is `examples/admissions-demo/journeys`; an operator can set `JOURNEYPROOF_FLOW_ROOT` at startup for another workspace-relative directory. The server workspace comes from `JOURNEYPROOF_WORKSPACE_ROOT` or startup cwd.

For the bundled fictional fixture, start `npm run demo` in the checkout. Supply `JOURNEY_DEMO_EMAIL` and `JOURNEY_DEMO_PASSWORD` outside tool arguments using the documented synthetic values in the repository README. Validate `examples/admissions-demo/journeys/happy-path.yaml`, then run it with `http://127.0.0.1:4173`. Restart the fixture before each full run; it resets in-memory admission 1. `npm run demo:broken` deliberately returns HTTP 500 on approval.

If MCP is disconnected, from the verified built checkout:

```bash
node dist/cli.js --help
node dist/cli.js doctor --flow examples/admissions-demo/journeys/happy-path.yaml
node dist/cli.js run --flow examples/admissions-demo/journeys/happy-path.yaml --json
node dist/cli.js report --run <RETURNED_RUN_ID>
```

CLI exit 0 means passed, 1 means executed journey failure, 2 means input/environment error. The CLI retains its separate explicit remote opt-in; this skill does not grant remote authorization. MCP rejects remote targets altogether.
