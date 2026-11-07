import { it, expect, vi } from "vitest";
import {
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { MapService } from "../../src/map/service.js";
import { checkedPath, regularFile } from "../../src/map/storage.js";
import { main } from "../../src/cli/main.js";
import { parseArgs } from "../../src/cli/args.js";
import { modelSource } from "./fixtures.js";
import { temp } from "../helpers.js";
async function writeSource(root: string, broken = false) {
  const source = modelSource(broken),
    dir = join(root, source.run.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "run.json"), JSON.stringify(source.run));
  await writeFile(
    join(dir, "observations.json"),
    JSON.stringify(source.observations),
  );
  return { source, dir };
}
it("persists portable actual-result excerpts, deterministic IDs and approved evidence without raw metadata", async () => {
  const t = await temp();
  try {
    const { source, dir } = await writeSource(t.dir, true);
    source.run.metadata.flowFile = "/home/private-machine/secret.yaml";
    source.run.errors = ["private page data"];
    await writeFile(join(dir, "run.json"), JSON.stringify(source.run));
    await writeFile(
      join(dir, "failure.png"),
      new Uint8Array([137, 80, 78, 71]),
    );
    await writeFile(
      join(dir, "trace.zip"),
      zipSync({
        "trace.trace": strToU8(
          JSON.stringify({ type: "after", result: "private result" }) + "\n",
        ),
      }),
    );
    const service = new MapService(t.dir);
    const first = await service.build([source.run.id]);
    const second = await service.build([source.run.id]);
    expect(second.map).toEqual(first.map);
    expect((await service.get(first.map.mapId)).map).toEqual(first.map);
    const html = await readFile(first.paths.html, "utf8");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("sha256-");
    expect(html).not.toContain("https://");
    const exported = await readFile(
      join(first.paths.json, "..", "evidence", source.run.id, "report.json"),
      "utf8",
    );
    expect(exported).not.toContain("private-machine");
    expect(exported).not.toContain("private page data");
    expect(
      first.map.evidence.find((e) => e.kind === "screenshot")!.available,
    ).toBe(true);
    const summary = service.summary(first.map, first.paths, t.dir, 1);
    expect(summary.truncated).toBe(true);
    expect(summary.nodes).toHaveLength(1);
    expect(JSON.stringify(summary)).not.toContain(t.dir);
    expect(() =>
      service.summary(first.map, first.paths, "/unrelated"),
    ).toThrow();
    await expect(service.get("../../etc/passwd")).rejects.toThrow();
    const out: string[] = [];
    const args = [
      "map",
      "--run",
      source.run.id,
      "--output-dir",
      t.dir,
      "--json",
    ];
    expect(await main(args, { out: (s) => out.push(s), err: () => {} })).toBe(
      0,
    );
    expect(JSON.parse(out[0]!).mapId).toBe(first.map.mapId);
  } finally {
    await t.cleanup();
  }
});
it("rejects corrupt/missing artifacts, symlinks, oversized files and mismatched IDs", async () => {
  const t = await temp(),
    outside = await temp();
  try {
    const { source, dir } = await writeSource(t.dir);
    const service = new MapService(t.dir);
    await expect(service.source("bad")).rejects.toThrow();
    await expect(service.get("map-" + "a".repeat(20))).rejects.toThrow();
    await expect(service.source("1793730000099-abcd1234")).rejects.toThrow();
    await writeFile(join(dir, "observations.json"), '{"schemaVersion":99}');
    await expect(service.build([source.run.id])).rejects.toThrow("corrupt");
    await rm(join(dir, "observations.json"));
    const legacy = await service.build([source.run.id]);
    expect(legacy.map.warnings.some((w) => w.includes("Legacy"))).toBe(true);
    await writeFile(legacy.paths.json, "invalid-json");
    await expect(service.get(legacy.map.mapId)).rejects.toThrow("corrupt");
    await writeFile(
      legacy.paths.json,
      JSON.stringify({ ...legacy.map, mapId: "map-" + "f".repeat(20) }),
    );
    await expect(service.get(legacy.map.mapId)).rejects.toThrow("corrupt");
    await rm(legacy.paths.json);
    await symlink(join(dir, "run.json"), legacy.paths.json);
    await expect(service.get(legacy.map.mapId)).rejects.toThrow("unsafe");
    await rm(join(t.dir, "maps"), { recursive: true });
    await symlink(outside.dir, join(t.dir, "maps"));
    await expect(service.build([source.run.id])).rejects.toThrow("unsafe");
    await rm(join(t.dir, "maps"));
    await writeFile(
      join(dir, "run.json"),
      JSON.stringify({ ...source.run, id: "1793730000099-abcd1234" }),
    );
    await expect(service.source(source.run.id)).rejects.toThrow("corrupt");
    await writeFile(join(dir, "run.json"), "x".repeat(2 * 1024 * 1024 + 1));
    await expect(service.source(source.run.id)).rejects.toThrow("limit");
    await expect(regularFile(dir, 100)).rejects.toThrow("limit");
    await expect(
      new MapService(join(dir, "run.json")).get("map-" + "a".repeat(20)),
    ).rejects.toThrow("unsafe");
    await expect(checkedPath(join(t.dir, "missing"))).rejects.toThrow();
  } finally {
    await t.cleanup();
    await outside.cleanup();
  }
});
it("serializes builds, cancels without leaving partial artifacts and validates CLI choices", async () => {
  const t = await temp();
  try {
    const { source } = await writeSource(t.dir);
    const service = new MapService(t.dir);
    const abort = new AbortController();
    abort.abort();
    await expect(
      service.build([source.run.id], undefined, abort.signal),
    ).rejects.toThrow("cancelled");
    await expect(service.build([])).rejects.toThrow();
    await expect(service.build([source.run.id], "../role")).rejects.toThrow();
    let release!: (value: Awaited<ReturnType<MapService["source"]>>) => void;
    const real = await service.source(source.run.id);
    const spy = vi.spyOn(service, "source").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = service.build(
      [source.run.id],
      undefined,
      controller.signal,
    );
    await expect(service.build([source.run.id])).rejects.toThrow("Another map");
    controller.abort();
    release(real);
    await expect(pending).rejects.toThrow("cancelled");
    spy.mockRestore();
    expect(await readdir(join(t.dir, "maps"))).toEqual([]);
    expect(
      parseArgs(["map", "--compare", source.run.id, "1793730000001-abcd1234"])
        .flags.compare,
    ).toContain(",");
    for (const args of [
      ["map"],
      ["map", "--run", "a", "--compare", "b", "c"],
      ["map", "--compare", "a"],
      ["map", "--run", "a", "--run", "b"],
    ])
      expect(() => parseArgs(args)).toThrow();
    const out: string[] = [];
    expect(
      await main(["map", "--run", "bad", "--json"], {
        out: (s) => out.push(s),
        err: () => {},
      }),
    ).toBe(2);
    expect(JSON.parse(out[0]!).status).toBe("error");
  } finally {
    await t.cleanup();
  }
});
