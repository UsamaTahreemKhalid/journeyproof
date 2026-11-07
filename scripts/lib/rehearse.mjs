import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyPackage } from "./package-check.mjs";
export async function rehearse(kind, verify) {
  const output = `.journeyproof/${kind}-rehearsal/manifest.json`;
  await mkdir(`.journeyproof/${kind}-rehearsal`, {
    recursive: true,
    mode: 0o700,
  });
  const record = async (value) =>
    writeFile(output, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await record({ status: "running", distributionAuthorized: false });
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--kit")
      throw Error("Choose a staged --kit path");
    const kit = await verify(process.cwd(), process.argv[3]);
    const report = await verifyPackage({
      archive: join(kit.directory, kit.manifest.archive),
      keep: true,
      temporaryPrefix:
        kind === "beta" ? "journeyproof bêta " : "journeyproof RC é ",
    });
    await record(report);
    console.log(JSON.stringify(report, null, 2));
  } catch {
    await record({ status: "failed", distributionAuthorized: false });
    console.error(
      "Installed candidate rehearsal failed; inspect local package evidence. No independent human validation is implied.",
    );
    process.exitCode = 1;
  }
}
