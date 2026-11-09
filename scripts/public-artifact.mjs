import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  inspectArchive,
  VERSION,
  assertReleaseVersion,
  releaseFilename,
} from "../dist/index.js";
import { npm } from "./lib/process.mjs";
import { packAudited, verifyPackage } from "./lib/package-check.mjs";
import { preflightPolicy } from "./lib/preflight.mjs";

await preflightPolicy();
const output = resolve(".journeyproof/npm-mcp-release/artifact");
const temporary = await mkdtemp(join(tmpdir(), "journeyproof-release-"));
try {
  const original = await packAudited(temporary);
  const inspected = inspectArchive(
    await readFile(join(temporary, original.pack.filename)),
  );
  const packageDir = join(temporary, "package");
  for (const [path, content] of inspected.entries) {
    const destination = join(packageDir, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  const metadata = inspected.metadata;
  assert.equal(metadata.name, "journeyproof");
  assertReleaseVersion(metadata.version);
  assert.equal(metadata.version, VERSION);
  if (process.env.APPROVED_VERSION)
    assert.equal(metadata.version, process.env.APPROVED_VERSION);
  const publicMetadata = {
    ...metadata,
    private: false,
    mcpName: "io.github.UsamaTahreemKhalid/journeyproof",
  };
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify(publicMetadata, null, 2) + "\n",
  );
  await chmod(join(packageDir, "dist/cli.js"), 0o755);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const packed = JSON.parse(
    (
      await npm([
        "pack",
        packageDir,
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        output,
      ])
    ).stdout,
  )[0];
  const artifact = join(output, packed.filename);
  assert.equal(packed.filename, releaseFilename(metadata.version));
  const bytes = await readFile(artifact);
  const checked = inspectArchive(bytes, undefined, "public", metadata.version);
  const manifest = {
    name: checked.metadata.name,
    version: checked.metadata.version,
    filename: packed.filename,
    mcpName: checked.metadata.mcpName,
    integrity: "sha512-" + createHash("sha512").update(bytes).digest("base64"),
    sha512: createHash("sha512").update(bytes).digest("hex"),
    files: checked.files,
  };
  assert.equal(packed.integrity, manifest.integrity);
  const smoke = await verifyPackage({
    archive: artifact,
    publicArtifact: true,
    expectedVersion: metadata.version,
  });
  await writeFile(
    join(output, "smoke.json"),
    JSON.stringify(smoke, null, 2) + "\n",
  );
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        artifact,
        integrity: manifest.integrity,
        files: manifest.files.length,
        smoke: smoke.status,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
