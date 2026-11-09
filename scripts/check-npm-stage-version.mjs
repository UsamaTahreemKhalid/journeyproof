import { execFileSync } from "node:child_process";
import { assertNpmStagingVersion } from "../src/distribution/version.ts";
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 11)
  throw new Error("Node 24.11 or newer within Node 24 is required");
const version = execFileSync("npm", ["--version"], {
  encoding: "utf8",
  timeout: 10000,
}).trim();
assertNpmStagingVersion(version);
console.log(`npm ${version} supports staged publishing`);
