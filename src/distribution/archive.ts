import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { z } from "zod";
import { auditManifest, auditText } from "./audit.js";
import { auditPackageScripts } from "./policy.js";
import { InputError } from "../shared/errors.js";
export const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const version = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)
  .max(50);
export const distributionMetadata = z
  .object({
    name: z.literal("journeyproof"),
    version,
    private: z.literal(true),
    license: z.literal("Apache-2.0"),
    mcpName: z.never().optional(),
    engines: z.object({ node: z.literal(">=24.11.0 <25") }),
    dependencies: z.record(z.string(), z.string().max(100)),
    devDependencies: z.record(z.string(), z.string().max(100)),
  })
  .passthrough();
// Strict npm ustar subset. No extraction, links, PAX overrides, paths outside package/,
// source maps, appended payloads or unbounded gzip expansion. Unknown formats fail closed.
export function inspectArchive(input: Uint8Array, expectedSha?: string) {
  const fail = () =>
    new InputError("Package archive is corrupt, unsafe or unsupported");
  if (input.byteLength > 3 * 1024 * 1024) throw fail();
  const digest = sha256(input);
  if (expectedSha !== undefined && digest !== expectedSha)
    throw new InputError("Package checksum mismatch");
  let tar: Buffer;
  try {
    tar = gunzipSync(input, { maxOutputLength: 6 * 1024 * 1024 });
  } catch {
    throw fail();
  }
  const entries = new Map<string, Buffer>();
  const files: { path: string; size: number; mode: number }[] = [];
  const text = (b: Buffer) => b.toString("utf8").replace(/\0.*$/s, "");
  const octal = (b: Buffer) => {
    const s = text(b).trim();
    if (!/^[0-7]+$/.test(s)) throw fail();
    return parseInt(s, 8);
  };
  let offset = 0,
    ended = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) {
      if (
        tar.length - offset < 1024 ||
        !tar.subarray(offset).every((b) => b === 0)
      )
        throw fail();
      ended = true;
      break;
    }
    const declared = octal(header.subarray(148, 156));
    let checksum = 0;
    for (let i = 0; i < 512; i++)
      checksum += i >= 148 && i < 156 ? 32 : header[i]!;
    if (checksum !== declared || ![0, 48].includes(header[156]!)) throw fail();
    const name = text(header.subarray(0, 100)),
      prefix = text(header.subarray(345, 500));
    const full = prefix ? prefix + "/" + name : name;
    if (!full.startsWith("package/") || full.includes("\\")) throw fail();
    const path = full.slice(8);
    const size = octal(header.subarray(124, 136));
    const mode = octal(header.subarray(100, 108));
    if (
      entries.has(path) ||
      size > 2 * 1024 * 1024 ||
      offset + 512 + size > tar.length
    )
      throw fail();
    const body = Buffer.from(tar.subarray(offset + 512, offset + 512 + size));
    entries.set(path, body);
    files.push({ path, size, mode });
    if (files.length > 200) throw fail();
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!ended) throw fail();
  const audit = auditManifest(files);
  // Windows chmod cannot set POSIX executable bits. npm installs a .cmd shim
  // there; package verification checks that shim and runs the installed CLI.
  if (
    process.platform !== "win32" &&
    !files.some((f) => f.path === "dist/cli.js" && (f.mode & 0o111) !== 0)
  )
    throw new InputError("Packaged executable mode missing");
  for (const [path, body] of entries) {
    if (path.endsWith(".png")) {
      if (
        body.length < 24 ||
        body.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      )
        throw fail();
      continue; // Curated image pixel privacy still requires human review.
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      throw fail();
    }
    auditText(content);
    if (path.endsWith(".md"))
      for (const link of content.matchAll(/\]\(([^)]+)\)/g)) {
        const target = link[1]!.replace(/^<(.+)>$/, "$1").split("#")[0]!;
        if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
        if (
          !entries.has(posix.normalize(posix.join(posix.dirname(path), target)))
        )
          throw new InputError("Packaged documentation target missing");
      }
  }
  let metadata;
  try {
    metadata = distributionMetadata.parse(
      JSON.parse(entries.get("package.json")!.toString("utf8")),
    );
  } catch {
    throw new InputError(
      "Package metadata is invalid or distribution guards changed",
    );
  }
  // Pin the complete official text, ignoring whitespace for CRLF portability.
  // https://www.apache.org/licenses/LICENSE-2.0.txt
  const license = entries.get("LICENSE")!.toString("utf8");
  if (
    sha256(license.trim().replace(/\s+/g, " ")) !==
    "0ffddef9e48f8a09aed5caf2d44f7ba1c1be2d9b8e0a6f693b1635b2d5566645"
  )
    throw new InputError("Complete official Apache-2.0 LICENSE required");
  if (!entries.get("NOTICE")!.toString("utf8").trim())
    throw new InputError("Package NOTICE must not be empty");
  auditPackageScripts(metadata.scripts);
  if (
    !metadata.dependencies.playwright ||
    [
      ...Object.values(metadata.dependencies),
      metadata.devDependencies["@playwright/test"],
      metadata.devDependencies.typescript,
      metadata.devDependencies["@types/node"],
    ].some((pin) => !pin || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pin))
  )
    throw new InputError(
      "Package runtime and rehearsal dependencies require exact registry version pins",
    );
  if (
    metadata.dependencies.playwright !==
    metadata.devDependencies["@playwright/test"]
  )
    throw new InputError("Playwright runtime/test versions disagree");
  return { sha256: digest, entries, files, audit, metadata };
}
