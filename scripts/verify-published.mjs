import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { npm } from "./lib/process.mjs";
import { verifyPackage } from "./lib/package-check.mjs";

// This command is deliberately excluded from CI; it requires an already-published package.
const dir = await mkdtemp(join(tmpdir(), "journeyproof-registry-"));
const registry = "https://registry.npmjs.org/";
try {
  const view = JSON.parse(
    (
      await npm([
        "view",
        "journeyproof@0.1.0-rc.1",
        "--json",
        "--registry",
        registry,
      ])
    ).stdout,
  );
  const tags = JSON.parse(
    (
      await npm([
        "view",
        "journeyproof",
        "dist-tags",
        "--json",
        "--registry",
        registry,
      ])
    ).stdout,
  );
  assert.equal(view.name, "journeyproof");
  assert.equal(view.version, "0.1.0-rc.1");
  assert.equal(view.mcpName, "io.github.UsamaTahreemKhalid/journeyproof");
  assert.equal(tags.next, view.version);
  assert.match(view.dist.integrity, /^sha512-/);
  const pack = JSON.parse(
    (
      await npm([
        "pack",
        "journeyproof@0.1.0-rc.1",
        "--ignore-scripts",
        "--json",
        "--registry",
        registry,
        "--pack-destination",
        dir,
      ])
    ).stdout,
  )[0];
  const archive = join(dir, pack.filename);
  const integrity =
    "sha512-" +
    createHash("sha512")
      .update(await readFile(archive))
      .digest("base64");
  assert.equal(integrity, view.dist.integrity);
  assert.equal(integrity, pack.integrity);
  const smoke = await verifyPackage({ archive, publicArtifact: true });
  assert.equal(smoke.status, "passed");
  console.log(
    JSON.stringify(
      {
        name: view.name,
        version: view.version,
        tag: "next",
        integrity,
        attestations: view.dist.attestations ?? null,
        smoke: smoke.status,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
