import { it, expect, vi } from "vitest";
import { gzipSync, gunzipSync } from "node:zlib";
import { inspectArchive, sha256 } from "../../src/distribution/archive.js";
import { payload, tarball } from "./fixtures.js";
it("inspects actual tar bytes without extraction, verifies digest, executable mode, assets and text", () => {
  const data = tarball(payload());
  const parsed = inspectArchive(data, sha256(data));
  expect(parsed.metadata.version).toBe("0.1.0");
  expect(parsed.audit.files).toBe(payload().size);
  expect(parsed.sha256).toBe(sha256(data));
  expect(() => inspectArchive(data, "f".repeat(64))).toThrow("checksum");
  const linked = payload();
  linked.set(
    "README.md",
    Buffer.from(
      "[guide](<docs/INSTALLATION.md>) [external](https://example.invalid) [fragment](#top)",
    ),
  );
  expect(() => inspectArchive(tarball(linked))).not.toThrow();
  linked.set("README.md", Buffer.from("[missing](docs/ABSENT.md)"));
  expect(() => inspectArchive(tarball(linked))).toThrow("target");
});
it("refuses missing executables, injected .env/secrets, source maps, traversal/UNC and linked tar members", () => {
  const missing = payload();
  missing.delete("dist/cli.js");
  expect(() => inspectArchive(tarball(missing))).toThrow("asset missing");
  for (const path of [
    ".env",
    "../secret",
    "%2e%2e/secret",
    "C:\\secret",
    "//server/share",
    "dist/index.js.map",
  ]) {
    const files = payload();
    files.set(path, Buffer.from("private"));
    expect(() => inspectArchive(tarball(files))).toThrow();
  }
  const secret = payload();
  secret.set("README.md", Buffer.from("npm_" + "a".repeat(40)));
  expect(() => inspectArchive(tarball(secret))).toThrow("Private credential");
  for (const type of [49, 50, 120, 103])
    expect(() => inspectArchive(tarball(payload(), { type }))).toThrow(
      "unsafe",
    );
  expect(() =>
    inspectArchive(tarball(payload(), { prefix: "other/" })),
  ).toThrow("unsafe");
});
it.each(["linux", "darwin", "win32"])(
  "validates executable permissions for %s without weakening archive checks",
  (platform) => {
    const executable = tarball(payload());
    const nonExecutable = tarball(payload(), { mode: 0o644 });
    const missing = payload();
    missing.delete("dist/cli.js");
    const secret = payload();
    secret.set("README.md", Buffer.from("npm_" + "a".repeat(40)));
    vi.stubGlobal("process", { ...process, platform });
    try {
      expect(() => inspectArchive(executable)).not.toThrow();
      if (platform === "win32")
        expect(() => inspectArchive(nonExecutable)).not.toThrow();
      else expect(() => inspectArchive(nonExecutable)).toThrow("mode");
      expect(() => inspectArchive(tarball(missing))).toThrow("asset missing");
      expect(() => inspectArchive(tarball(secret))).toThrow(
        "Private credential",
      );
      expect(() => inspectArchive(tarball(payload(), { type: 50 }))).toThrow(
        "unsafe",
      );
      expect(() => inspectArchive(executable, "f".repeat(64))).toThrow(
        "checksum",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
it("bounds compressed/uncompressed data and rejects truncation, invalid checksums, duplicate paths and hidden trailing bytes", () => {
  expect(() => inspectArchive(new Uint8Array(3 * 1024 * 1024 + 1))).toThrow();
  expect(() => inspectArchive(Buffer.from("not gzip"))).toThrow();
  expect(() =>
    inspectArchive(gzipSync(Buffer.alloc(7 * 1024 * 1024))),
  ).toThrow();
  const archive = tarball(payload());
  expect(() =>
    inspectArchive(archive.subarray(0, archive.length - 4)),
  ).toThrow();
  const raw = gunzipSync(archive);
  raw[0] = 0;
  expect(() => inspectArchive(gzipSync(raw))).toThrow();
  expect(() =>
    inspectArchive(
      tarball(payload(), { extra: Buffer.from("hidden private payload") }),
    ),
  ).toThrow();
  const duplicate = Buffer.concat([
    gunzipSync(archive).subarray(0, -1024),
    gunzipSync(archive),
  ]);
  expect(() => inspectArchive(gzipSync(duplicate))).toThrow();
  expect(() =>
    inspectArchive(gzipSync(gunzipSync(archive).subarray(0, -1024))),
  ).toThrow();
  const big = payload();
  big.set("dist/big.js", Buffer.alloc(2 * 1024 * 1024 + 1));
  expect(() => inspectArchive(tarball(big))).toThrow();
});
it("rejects corrupt metadata/encoding/image assets and mismatched runtime dependencies", () => {
  for (const mutate of [
    (f: Map<string, Buffer>) => f.set("package.json", Buffer.from("not json")),
    (f: Map<string, Buffer>) => f.set("dist/index.js", Buffer.from([0xff])),
    (f: Map<string, Buffer>) =>
      f.set("docs/assets/demo-failure.png", Buffer.alloc(24)),
    (f: Map<string, Buffer>) => {
      const m = JSON.parse(f.get("package.json")!.toString());
      m.dependencies.playwright = "1.0.0";
      f.set("package.json", Buffer.from(JSON.stringify(m)));
    },
    (f: Map<string, Buffer>) => {
      const m = JSON.parse(f.get("package.json")!.toString());
      m.dependencies.playwright = "workspace:*";
      f.set("package.json", Buffer.from(JSON.stringify(m)));
    },
    (f: Map<string, Buffer>) => {
      const m = JSON.parse(f.get("package.json")!.toString());
      m.dependencies.prettier = "file:../private";
      f.set("package.json", Buffer.from(JSON.stringify(m)));
    },
    (f: Map<string, Buffer>) => {
      const m = JSON.parse(f.get("package.json")!.toString());
      delete m.devDependencies.typescript;
      f.set("package.json", Buffer.from(JSON.stringify(m)));
    },
  ]) {
    const files = payload();
    mutate(files);
    expect(() => inspectArchive(tarball(files))).toThrow();
  }
});

it("requires the complete Apache-2.0 license and notices while refusing publication metadata", () => {
  const files = payload();
  const inspected = inspectArchive(tarball(files));
  expect(inspected.metadata.license).toBe("Apache-2.0");
  expect(inspected.metadata.private).toBe(true);
  expect(inspected.metadata.mcpName).toBeUndefined();
  for (const name of ["LICENSE", "NOTICE"]) {
    expect(inspected.entries.get(name)).toEqual(files.get(name));
    const missing = new Map(files);
    missing.delete(name);
    expect(() => inspectArchive(tarball(missing))).toThrow("asset missing");
  }
  for (const text of [
    "",
    "Apache License 2.0",
    files.get("LICENSE")!.toString().replace("irrevocable", "revocable"),
  ]) {
    const invalid = new Map(files);
    invalid.set("LICENSE", Buffer.from(text));
    expect(() => inspectArchive(tarball(invalid))).toThrow(
      "official Apache-2.0",
    );
  }
  const emptyNotice = new Map(files);
  emptyNotice.set("NOTICE", Buffer.from(" \n"));
  expect(() => inspectArchive(tarball(emptyNotice))).toThrow("NOTICE");
  const crlf = new Map(files);
  crlf.set(
    "LICENSE",
    Buffer.from(files.get("LICENSE")!.toString().replace(/\n/g, "\r\n")),
  );
  expect(() => inspectArchive(tarball(crlf))).not.toThrow();
  for (const change of [
    { private: false },
    { license: "UNLICENSED" },
    { license: "MIT" },
    { mcpName: "io.github.UsamaTahreemKhalid/journeyproof" },
  ]) {
    const invalid = new Map(files);
    invalid.set(
      "package.json",
      Buffer.from(JSON.stringify({ ...inspected.metadata, ...change })),
    );
    expect(() => inspectArchive(tarball(invalid))).toThrow("guards changed");
  }
});

it("only accepts the exact public identity in explicit public inspection mode", () => {
  const files = payload();
  const meta = JSON.parse(files.get("package.json")!.toString());
  const publicMeta = {
    ...meta,
    private: false,
    version: "0.1.0-rc.1",
    mcpName: "io.github.UsamaTahreemKhalid/journeyproof",
  };
  const make = (metadata: object) => {
    const data = new Map(files);
    data.set("package.json", Buffer.from(JSON.stringify(metadata)));
    return tarball(data);
  };
  expect(() => inspectArchive(make(publicMeta))).toThrow();
  expect(
    inspectArchive(make(publicMeta), undefined, "public").metadata.mcpName,
  ).toBe(publicMeta.mcpName);
  for (const change of [
    { private: true },
    { name: "other" },
    { version: "0.1.0-rc.2" },
    { mcpName: "io.github.other/journeyproof" },
  ]) {
    expect(() =>
      inspectArchive(make({ ...publicMeta, ...change }), undefined, "public"),
    ).toThrow();
  }
});
