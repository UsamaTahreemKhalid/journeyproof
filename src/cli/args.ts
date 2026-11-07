import { InputError } from "../shared/errors.js";
export const HELP = `JourneyProof — local browser evidence for explicit user journeys
Usage:
  journeyproof --version | --help
  journeyproof mcp
  journeyproof init [--dir .] [--force]
  journeyproof doctor [--flow FILE] [--output-dir DIR] [--no-browser] [--json]
  journeyproof run --flow FILE [--base-url ORIGIN] [--json]
    [--output-dir DIR] [--timeout-ms 5000] [--headed] [--allow-remote]
  journeyproof map (--run ID | --compare BASELINE CANDIDATE) [--role LABEL] [--open] [--json] [--output-dir DIR]
  journeyproof generate-test (--run ID | --flow FILE) [--dry-run] [--out tests/generated/NAME.spec.ts] [--draft] [--force] [--json]
  journeyproof coverage --flow FILE --runs ID,ID [--format table|json]
  journeyproof report --run ID [--output-dir DIR] [--open]
Exit codes: 0 passed/command succeeded; 1 journey failed; 2 input/environment error.
Remote targets require --allow-remote and authorization to test the target.
`;
const flags: Record<string, string[]> = {
  "generate-test": ["run", "flow", "dry-run", "out", "draft", "force", "json"],
  coverage: ["flow", "runs", "format", "json"],
  mcp: [],
  init: ["dir", "force"],
  doctor: ["flow", "output-dir", "json", "no-browser"],
  run: [
    "flow",
    "base-url",
    "json",
    "output-dir",
    "timeout-ms",
    "headed",
    "allow-remote",
  ],
  map: ["run", "compare", "role", "open", "json", "output-dir"],
  report: ["run", "output-dir", "open"],
};
const bools = new Set([
  "no-browser",
  "dry-run",
  "draft",
  "force",
  "json",
  "headed",
  "allow-remote",
  "open",
]);
export function parseArgs(args: string[]) {
  if (
    args.length === 2 &&
    args[1] === "--help" &&
    Object.hasOwn(flags, args[0]!)
  )
    return {
      command: "help",
      flags: { topic: args[0]! } as Record<string, string | boolean>,
    };
  if (args.length === 0 || (args.length === 1 && args[0] === "--help"))
    return { command: "help", flags: {} as Record<string, string | boolean> };
  if (args.length === 1 && args[0] === "--version")
    return {
      command: "version",
      flags: {} as Record<string, string | boolean>,
    };
  const command = args[0]!;
  if (!Object.hasOwn(flags, command))
    throw new InputError("Unknown command. Use --help");
  const result: Record<string, string | boolean> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--") || !flags[command]!.includes(arg.slice(2)))
      throw new InputError("Unknown flag or positional argument. Use --help");
    const key = arg.slice(2);
    if (key in result) throw new InputError(`Duplicate flag --${key}`);
    if (bools.has(key)) result[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new InputError(`Missing value for --${key}`);
      if (key === "compare") {
        const candidate = args[++i];
        if (!candidate || candidate.startsWith("--"))
          throw new InputError(
            "--compare requires baseline and candidate run IDs",
          );
        result[key] = value + "," + candidate;
      } else result[key] = value;
    }
  }
  if (command === "map" && Boolean(result.run) === Boolean(result.compare))
    throw new InputError(
      "map requires either --run ID or --compare BASELINE CANDIDATE",
    );
  if (command === "run" && !result.flow)
    throw new InputError("run requires --flow FILE");
  if (command === "report" && !result.run)
    throw new InputError("report requires --run ID");
  if (
    result["timeout-ms"] &&
    (!/^\d+$/.test(String(result["timeout-ms"])) ||
      Number(result["timeout-ms"]) < 100 ||
      Number(result["timeout-ms"]) > 30000)
  )
    throw new InputError("--timeout-ms must be an integer from 100 to 30000");
  return { command, flags: result };
}

export const COMMAND_HELP: Record<string, string> = {
  doctor:
    "doctor checks Node, workspace, optional Chromium launch and artifact writability. --no-browser is an offline lightweight check, not browser readiness. It never installs anything.",
  run: "Run: journeyproof run --flow examples/admissions-demo/journeys/happy-path.yaml --json\nSupply required environment inputs and an authorized target; restart stateful fixtures. Exit 1 means a real journey failure; exit 2 means input/environment error.",
  report:
    "Report: journeyproof report --run ID. Use a printed saved ID and the original artifact root. --open is best effort; Windows users open the printed path manually.",
  map: "Map: journeyproof map --compare HEALTHY_ID BROKEN_ID --json. Recorded observations only; linked routes are not visited automatically.",
  "generate-test":
    "Generation: choose exactly one --run ID or --flow FILE. --dry-run writes nothing. Outputs stay under tests/generated. --draft creates non-executable .draft.md. Modified files require explicit CLI --force. Review and execute separately.",
  coverage:
    "Coverage: journeyproof coverage --flow FILE --runs ID,ID --format table. Counts only selected declared steps and recorded assertion outcomes, never whole-app coverage.",
  mcp: "MCP: journeyproof mcp. Silence is normal while waiting for an MCP client. Set JOURNEYPROOF_WORKSPACE_ROOT to the application root and JOURNEYPROOF_FLOW_ROOT to its approved relative flow directory. Numeric loopback targets only. Never use npm run as the stdio host command.",
  init: "Init: journeyproof init --dir . creates .journeyproof/example.yaml. Existing files are preserved unless --force is explicitly requested.",
};
