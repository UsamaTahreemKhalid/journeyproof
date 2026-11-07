import { readFile, readdir, lstat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { npm } from "./lib/process.mjs";
const paths = (await npm(["ls", "--omit=dev", "--all", "--parseable"])).stdout
  .trim()
  .split(/\r?\n/)
  .slice(1);
const inventory = [];
for (const path of [...new Set(paths)].sort()) {
  const meta = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
  const notices = [];
  for (const file of (await readdir(path)).filter((name) =>
    /^(?:licen[sc]e|notice|copying)(?:[._-].*)?$/i.test(name),
  )) {
    const absolute = join(path, file),
      info = await lstat(absolute);
    if (!info.isFile() || info.size > 1024 * 1024)
      throw Error("Notice file budget/type invalid");
    notices.push({
      file,
      bytes: info.size,
      sha256: createHash("sha256")
        .update(await readFile(absolute))
        .digest("hex"),
    });
  }
  inventory.push({
    name: meta.name,
    version: meta.version,
    declaredLicense:
      typeof meta.license === "string"
        ? meta.license
        : (meta.license?.type ?? "UNKNOWN"),
    notices,
  });
}
const result = {
  schemaVersion: 1,
  scope:
    "Actual installed production dependency closure; declared metadata/notice hashes, not legal approval",
  packages: inventory,
  ownerLegalReview: "OWNER DECISION REQUIRED",
};
await mkdir(".journeyproof/license-inventory", {
  recursive: true,
  mode: 0o700,
});
await writeFile(
  ".journeyproof/license-inventory/manifest.json",
  JSON.stringify(result, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
