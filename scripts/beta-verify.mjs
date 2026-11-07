import { verifyBetaKit } from "../dist/index.js";
try {
  if (process.argv.length !== 4 || process.argv[2] !== "--kit")
    throw Error("Choose --kit artifacts/beta/KIT");
  const result = await verifyBetaKit(process.cwd(), process.argv[3]);
  console.log(
    JSON.stringify({
      status: "passed",
      version: result.manifest.version,
      sha256: result.inspection.sha256,
      distributionAuthorized: false,
    }),
  );
} catch {
  console.error(
    "Beta verification failed: check the kit path, manifest, package contents and checksum. No execution or sharing is authorized.",
  );
  process.exitCode = 2;
}
