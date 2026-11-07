import { it, expect } from "vitest";
import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  symlink,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { RegressionService } from "../../src/regression/service.js";
import { workspace, source, saveSource, journey } from "./fixtures.js";
it("dry run creates no files, explicit writes are idempotent and changes need force", async () => {
  const t = await workspace();
  try {
    const service = new RegressionService(t.policy);
    const before = await readdir(t.dir);
    const options = {
      flowPath: "flows/test.yaml",
      outPath: "tests/generated/test.spec.ts",
    };
    const preview = await service.generate({ ...options, dryRun: true });
    expect(preview.eligible).toBe(true);
    expect(preview.written).toBe(false);
    expect(await readdir(t.dir)).toEqual(before);
    const written = await service.generate(options);
    expect(written.written).toBe(true);
    expect(await readFile(join(t.dir, options.outPath), "utf8")).toBe(
      preview.preview,
    );
    expect((await service.generate(options)).written).toBe(false);
    await writeFile(join(t.dir, options.outPath), "// developer edit\n");
    await expect(service.generate(options)).rejects.toThrow("already exists");
    expect((await service.generate({ ...options, force: true })).written).toBe(
      true,
    );
    expect(
      (await readdir(join(t.dir, "tests/generated"))).some((f) =>
        f.endsWith(".tmp"),
      ),
    ).toBe(false);
  } finally {
    await t.cleanup();
  }
});
it("requires one source and prevents traversal, source writes, absolute paths, symlinks and unsafe extensions", async () => {
  const t = await workspace(),
    outside = await workspace();
  try {
    const service = new RegressionService(t.policy);
    for (const options of [
      {},
      { flowPath: "flows/test.yaml", runId: "1793730000000-abcd1234" },
    ])
      await expect(service.generate(options)).rejects.toThrow("exactly one");
    for (const outPath of [
      "/tmp/a.spec.ts",
      "../outside.spec.ts",
      "tests/generated/../x.spec.ts",
      "src/a.spec.ts",
      "tests/generated/file.js",
      "tests/generated/./a.spec.ts",
      "tests/generated/evil$(touch x).spec.ts",
    ])
      await expect(
        service.generate({
          flowPath: "flows/test.yaml",
          outPath,
          dryRun: true,
        }),
      ).rejects.toThrow();
    await mkdir(join(t.dir, "tests"));
    await symlink(outside.dir, join(t.dir, "tests/generated"));
    await expect(
      service.generate({
        flowPath: "flows/test.yaml",
        outPath: "tests/generated/file.spec.ts",
      }),
    ).rejects.toThrow();
    await rm(join(t.dir, "tests/generated"));
    await mkdir(join(t.dir, "tests/generated"));
    await symlink(
      join(outside.dir, "flows/test.yaml"),
      join(t.dir, "tests/generated/file.spec.ts"),
    );
    await expect(
      service.generate({
        flowPath: "flows/test.yaml",
        outPath: "tests/generated/file.spec.ts",
        force: true,
      }),
    ).rejects.toThrow();
    await expect(
      service.generate({ runId: "../../etc/passwd" }),
    ).rejects.toThrow();
    await expect(
      service.generate({
        flowPath: "flows/test.yaml",
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow("cancelled");
  } finally {
    await t.cleanup();
    await outside.cleanup();
  }
});
it("reads only verified matching linked runs and rejects corrupt or absent source linkage", async () => {
  const t = await workspace();
  try {
    const service = new RegressionService(t.policy),
      s = source();
    const dir = await saveSource(t.dir, s, t.hash);
    const result = await service.generate({ runId: s.run.id, dryRun: true });
    expect(result.source.mode).toBe("verified-run");
    expect(result.eligible).toBe(true);
    await writeFile(
      join(dir, "source.json"),
      JSON.stringify({ schemaVersion: 0 }),
    );
    await expect(service.generate({ runId: s.run.id })).rejects.toThrow(
      "linkage",
    );
    await rm(join(dir, "source.json"));
    await expect(service.generate({ runId: s.run.id })).rejects.toThrow();
    await saveSource(t.dir, s, t.hash);
    await writeFile(
      join(t.dir, "flows/test.yaml"),
      (await readFile(join(t.dir, "flows/test.yaml"), "utf8")) + "\n",
    );
    expect((await service.generate({ runId: s.run.id })).diagnostics).toContain(
      "UNVERIFIED_RUN",
    );
  } finally {
    await t.cleanup();
  }
});
it("drafts remain non-executable and ineligible previews expose no private assertions", async () => {
  const t = await workspace({
    ...journey,
    steps: [
      {
        id: "private",
        action: "expectText",
        locator: { testId: "result" },
        text: "private@example.test",
      },
    ],
  });
  try {
    const service = new RegressionService(t.policy);
    const result = await service.generate({
      flowPath: "flows/test.yaml",
      outPath: "tests/generated/private.spec.ts",
    });
    expect(result.eligible).toBe(false);
    expect(result.preview).toBe("");
    expect(result.written).toBe(false);
    const draft = await service.generate({
      flowPath: "flows/test.yaml",
      outPath: "tests/generated/private.draft.md",
      draft: true,
    });
    expect(draft.preview).toContain("NOT VERIFIED");
    expect(draft.preview).not.toContain("private@example.test");
    expect(draft.written).toBe(true);
    await expect(
      service.generate({
        flowPath: "flows/test.yaml",
        outPath: "tests/generated/private.spec.ts",
        draft: true,
      }),
    ).rejects.toThrow("drafts");
  } finally {
    await t.cleanup();
  }
});
it("bounds large output and truncates safe previews without emitting partial executable files", async () => {
  const t = await workspace({
    ...journey,
    steps: Array.from({ length: 100 }, (_, i) => ({
      id: `s${i}`,
      action: "expectText" as const,
      locator: { testId: "x" },
      text: "A".repeat(500),
    })),
  });
  try {
    const service = new RegressionService(t.policy);
    await expect(
      service.generate({ flowPath: "flows/test.yaml", dryRun: true }),
    ).rejects.toThrow("128 KiB");
    const yaml = await readFile(join(t.dir, "flows/test.yaml"), "utf8");
    const { parse, stringify } = await import("yaml");
    const smaller = parse(yaml);
    smaller.steps = smaller.steps.slice(0, 40);
    await writeFile(join(t.dir, "flows/test.yaml"), stringify(smaller));
    const result = await service.generate({
      flowPath: "flows/test.yaml",
      dryRun: true,
    });
    expect(result.truncated).toBe(true);
    expect(result.preview.length).toBe(12000);
  } finally {
    await t.cleanup();
  }
});

it("rejects malformed source without echoing attacker-controlled field names", async () => {
  const t = await workspace();
  try {
    await writeFile(
      join(t.dir, "flows/test.yaml"),
      "schemaVersion: 1\nprivate-token-should-not-echo: secret\n",
    );
    await expect(
      new RegressionService(t.policy).generate({ flowPath: "flows/test.yaml" }),
    ).rejects.toThrow(/^Approved flow is invalid/);
  } finally {
    await t.cleanup();
  }
});
it("conflicting concurrent writes cannot overwrite each other's source", async () => {
  const t = await workspace();
  try {
    const service = new RegressionService(t.policy);
    const yaml = await readFile(join(t.dir, "flows/test.yaml"), "utf8");
    await writeFile(
      join(t.dir, "flows/other.yaml"),
      yaml.replace("Approved", "Reviewed"),
    );
    const options = { outPath: "tests/generated/concurrent.spec.ts" };
    const results = await Promise.allSettled([
      service.generate({ ...options, flowPath: "flows/test.yaml" }),
      service.generate({ ...options, flowPath: "flows/other.yaml" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const succeeded = results.find((r) => r.status === "fulfilled")!;
    if (succeeded.status !== "fulfilled") throw Error();
    expect(await readFile(join(t.dir, options.outPath), "utf8")).toBe(
      succeeded.value.preview,
    );
    expect(await readdir(join(t.dir, "tests/generated"))).toEqual([
      "concurrent.spec.ts",
    ]);
  } finally {
    await t.cleanup();
  }
});
