import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { checkedPath } from "../../src/map/storage.js";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
  lstat: vi.fn(),
  realpath: vi.fn(),
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("canonicalizes Windows short names while checking every path component", async () => {
  vi.stubGlobal("process", { ...process, platform: "win32" });
  const lstat = vi
    .mocked(fs.lstat)
    .mockImplementation(
      async () =>
        ({ isSymbolicLink: () => false }) as Awaited<
          ReturnType<typeof fs.lstat>
        >,
    );
  vi.mocked(fs.realpath).mockImplementation(async (path) => {
    const current = String(path);
    return basename(current) === "RUNNER~1"
      ? join(dirname(current), "runneradmin")
      : current;
  });
  const input = resolve("windows-test/Users/RUNNER~1/AppData/runs");
  const canonical = resolve("windows-test/Users/runneradmin/AppData/runs");
  expect(await checkedPath(input)).toBe(canonical);
  expect(lstat).toHaveBeenCalledWith(canonical);
  lstat.mockImplementation(async (path) => {
    if (["maps", "new-map"].includes(basename(String(path))))
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return { isSymbolicLink: () => false } as Awaited<
      ReturnType<typeof fs.lstat>
    >;
  });
  await expect(checkedPath(join(input, "maps", "new-map"), true)).resolves.toBe(
    join(canonical, "maps", "new-map"),
  );
  await expect(checkedPath(join(input, "maps"))).rejects.toThrow();
});

it("rejects links and paths redirected outside their canonical parent on Windows", async () => {
  vi.stubGlobal("process", { ...process, platform: "win32" });
  const lstat = vi
    .mocked(fs.lstat)
    .mockImplementation(
      async () =>
        ({ isSymbolicLink: () => false }) as Awaited<
          ReturnType<typeof fs.lstat>
        >,
    );
  vi.mocked(fs.realpath).mockImplementation(async (path) =>
    basename(String(path)) === "redirect"
      ? resolve("outside/redirect")
      : String(path),
  );
  await expect(checkedPath(resolve("safe/redirect/child"))).rejects.toThrow(
    "unsafe",
  );
  lstat.mockImplementation(
    async (path) =>
      ({ isSymbolicLink: () => basename(String(path)) === "link" }) as Awaited<
        ReturnType<typeof fs.lstat>
      >,
  );
  await expect(checkedPath(resolve("safe/link/child"))).rejects.toThrow(
    "unsafe",
  );
});
