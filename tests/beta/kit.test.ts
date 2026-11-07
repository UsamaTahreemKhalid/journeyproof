import { it, expect } from "vitest";
import {
  readdir,
  writeFile,
  readFile,
  symlink,
  mkdir,
  rm,
} from "node:fs/promises";
import { join, relative } from "node:path";
import {
  planBetaKit,
  stageBetaKit,
  verifyBetaKit,
  parseVerificationLog,
  validateBetaFiles,
} from "../../src/distribution/beta.js";
import { sha256 } from "../../src/distribution/archive.js";
import { temp } from "../helpers.js";
import {
  payload,
  tarball,
  gate,
  rehearsal,
  digest,
  build,
  log,
} from "./fixtures.js";
const input = () => ({
  archive: tarball(payload()),
  gate,
  rehearsal,
  sourceDigest: digest,
  buildDigest: build,
  commit: "c".repeat(40),
  node: "v24.22.0",
  platform: "linux",
});
it("stages deterministic private kits from successful current evidence and verifies their exact payload", async () => {
  const t = await temp();
  try {
    const plan = planBetaKit(input());
    expect(planBetaKit(input()).manifest).toEqual(plan.manifest);
    expect(plan.manifest.distributionAuthorized).toBe(false);
    expect(plan.manifest.externalTesters).toBe(0);
    const dir = await stageBetaKit(t.dir, plan);
    const path = relative(t.dir, dir).split("\\").join("/");
    const result = await verifyBetaKit(t.dir, path);
    expect(result.inspection.sha256).toBe(sha256(plan.bytes));
    expect(await readFile(join(dir, "INSTALL.md"), "utf8")).toContain(
      "@playwright/test@1.64.1",
    );
    expect(
      await readFile(join(dir, "BETA_OWNER_APPROVAL_REQUIRED.txt"), "utf8"),
    ).toContain("NOT authorized");
    await expect(stageBetaKit(t.dir, plan)).rejects.toThrow("already exists");
    await expect(verifyBetaKit(t.dir, "../outside")).rejects.toThrow(
      "relative",
    );
    await writeFile(join(dir, plan.archive), Buffer.from("corrupt archive"));
    await expect(verifyBetaKit(t.dir, path)).rejects.toThrow("integrity");
  } finally {
    await t.cleanup();
  }
});
it("refuses stale or failed/skipped/low-coverage proof and unverified rehearsal without creating a ready kit", async () => {
  for (const bad of [
    { ...gate, status: "failed" },
    { ...gate, ci: { ...gate.ci, failed: 1 } },
    { ...gate, ci: { ...gate.ci, skipped: 1 } },
    {
      ...gate,
      ci: { ...gate.ci, coverage: { ...gate.ci.coverage, branches: 79 } },
    },
    { ...gate, advisories: 1 },
  ])
    expect(() => planBetaKit({ ...input(), gate: bad })).toThrow("successful");
  expect(() =>
    planBetaKit({ ...input(), sourceDigest: "d".repeat(64) }),
  ).toThrow("stale");
  expect(() =>
    planBetaKit({ ...input(), buildDigest: "d".repeat(64) }),
  ).toThrow("stale");
  expect(() =>
    planBetaKit({
      ...input(),
      rehearsal: { ...rehearsal, mcpRunVerified: false },
    }),
  ).toThrow("successful");
  const files = payload();
  files.set(".env", Buffer.from("secret"));
  expect(() => planBetaKit({ ...input(), archive: tarball(files) })).toThrow();
});
it("rejects tampered docs, manifests, extra files, oversized files and symlink outputs without touching unrelated data", async () => {
  const t = await temp(),
    outside = await temp();
  try {
    const plan = planBetaKit(input());
    await mkdir(join(t.dir, "artifacts"));
    await symlink(outside.dir, join(t.dir, "artifacts/beta"));
    await expect(stageBetaKit(t.dir, plan)).rejects.toThrow();
    expect(await readdir(outside.dir)).toEqual([]);
    await rm(join(t.dir, "artifacts/beta"));
    const dir = await stageBetaKit(t.dir, plan),
      path = relative(t.dir, dir).split("\\").join("/");
    await writeFile(join(dir, "unexpected.txt"), "not authorized");
    await expect(verifyBetaKit(t.dir, path)).rejects.toThrow("Unexpected");
    await rm(join(dir, "unexpected.txt"));
    const original = await readFile(join(dir, "INSTALL.md"));
    await writeFile(join(dir, "INSTALL.md"), "tampered");
    await expect(verifyBetaKit(t.dir, path)).rejects.toThrow("integrity");
    await writeFile(join(dir, "INSTALL.md"), original);
    await rm(join(dir, "INSTALL.md"));
    await symlink(join(outside.dir, "no-file"), join(dir, "INSTALL.md"));
    await expect(verifyBetaKit(t.dir, path)).rejects.toThrow();
    await rm(join(dir, "INSTALL.md"));
    await writeFile(join(dir, "INSTALL.md"), Buffer.alloc(3 * 1024 * 1024 + 1));
    await expect(verifyBetaKit(t.dir, path)).rejects.toThrow("size");
    await writeFile(join(dir, "INSTALL.md"), original);
    await writeFile(join(dir, "beta-manifest.json"), "{bad");
    await expect(verifyBetaKit(t.dir, path)).rejects.toThrow("manifest JSON");
  } finally {
    await t.cleanup();
    await outside.cleanup();
  }
});
it("requires complete actual test summaries and rejects logs containing a failed attempt or unknown format", () => {
  expect(parseVerificationLog(log)).toEqual(gate.ci);
  for (const bad of [
    "",
    log.replace("141 passed (141)", "140 passed (141)"),
    log.replace("Statements : 97.25%", "no statements"),
    log + "Tests 1 failed | 141 passed (142)\n",
    log.replace("6 passed (10.5s)", "6 skipped (10.5s)"),
    log.replace("Branches : 93.71%", "Branches : 79%"),
  ])
    expect(() => parseVerificationLog(bad)).toThrow();
  expect(parseVerificationLog("\u001b[32m" + log + "\u001b[0m")).toEqual(
    gate.ci,
  );
});
it("validates structural kit provenance, document checksums and names at the write boundary", async () => {
  const t = await temp();
  try {
    const plan = planBetaKit(input());
    await expect(
      stageBetaKit(t.dir, {
        ...plan,
        documents: Object.assign({}, plan.documents, { "../escape": "bad" }),
      }),
    ).rejects.toThrow();
    expect(await readdir(t.dir)).toEqual([]);
    const map = new Map(
      Object.entries({
        ...plan.documents,
        [plan.archive]: plan.bytes,
        "SHA256SUMS.txt": `${sha256(plan.bytes)}  ${plan.archive}\n`,
        "beta-manifest.json": JSON.stringify(plan.manifest),
      }).map(([name, body]) => [name, Buffer.from(body)]),
    );
    for (const manifest of [
      { ...plan.manifest, version: "9.0.0" },
      {
        ...plan.manifest,
        files: [...plan.manifest.files.slice(1), plan.manifest.files[1]],
      },
      { ...plan.manifest, kitId: "f".repeat(20) },
      { ...plan.manifest, schemaVersion: 2 },
    ])
      expect(() => validateBetaFiles(manifest, map)).toThrow();
    const changed = new Map(map);
    changed.set("SHA256SUMS.txt", Buffer.from("wrong"));
    expect(() => validateBetaFiles(plan.manifest, changed)).toThrow("Checksum");
  } finally {
    await t.cleanup();
  }
});
