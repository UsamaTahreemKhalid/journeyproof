import assert from "node:assert/strict";
import { readFile, appendFile, rm } from "node:fs/promises";
import { VERSION } from "../src/shared/version.ts";
import {
  assertReleaseVersion,
  releaseFilename,
} from "../src/distribution/version.ts";
if (process.argv.slice(2).some((arg) => arg !== "--clear-output"))
  throw new Error("Unknown release-version option");
if (process.argv.includes("--clear-output")) {
  for (const name of ["manifest.json", "smoke.json"])
    await rm(`.journeyproof/npm-mcp-release/artifact/${name}`, { force: true });
}
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const server = JSON.parse(await readFile(".mcp/server.json.example", "utf8"));
assertReleaseVersion(pkg.version);
assert.equal(pkg.version, VERSION);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[""].version, pkg.version);
assert.equal(pkg.private, true);
assert.equal(pkg.name, "journeyproof");
assert.equal(pkg.mcpName, undefined);
assert.equal(server.name, "io.github.UsamaTahreemKhalid/journeyproof");
assert.equal(server.version, pkg.version);
assert.equal(server.packages[0].identifier, pkg.name);
assert.equal(server.packages[0].version, pkg.version);
if (process.env.APPROVED_VERSION !== undefined)
  assert.equal(process.env.APPROVED_VERSION, pkg.version);
const filename = releaseFilename(pkg.version);
if (process.env.GITHUB_OUTPUT)
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `filename=${filename}\nversion=${pkg.version}\n`,
  );
console.log(JSON.stringify({ name: pkg.name, version: pkg.version, filename }));
