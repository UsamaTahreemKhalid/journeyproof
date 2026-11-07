import { join } from "node:path";
import { lstat } from "node:fs/promises";
import { runSchema, type RunResult } from "../shared/types.js";
import { readBounded, runDirectory, writePrivate } from "../evidence/store.js";
import { renderReport } from "./render.js";
import { InputError } from "../shared/errors.js";
export async function writeReport(dir: string, run: RunResult) {
  runSchema.parse(run);
  const available = new Set<string>();
  for (const name of ["failure.png", "trace.zip"]) {
    try {
      if ((await lstat(join(dir, name))).isFile()) available.add(name);
    } catch {
      /* Absent evidence is reported honestly. */
    }
  }
  await writePrivate(
    join(dir, "run.json"),
    JSON.stringify(run, null, 2) + "\n",
  );
  await writePrivate(join(dir, "index.html"), renderReport(run, available));
  return { json: join(dir, "run.json"), html: join(dir, "index.html") };
}
export async function regenerateReport(root: string, id: string) {
  const dir = await runDirectory(root, id);
  const parsed = runSchema.safeParse(
    JSON.parse(await readBounded(join(dir, "run.json"))),
  );
  if (!parsed.success || parsed.data.id !== id)
    throw new InputError("Invalid run result or mismatched run ID");
  return writeReport(dir, parsed.data);
}
