import { verifyReleaseCandidate } from "../dist/index.js";
try {
  if (process.argv.length !== 4 || process.argv[2] !== "--kit")
    throw Error("Choose --kit artifacts/rc/KIT");
  const { manifest } = await verifyReleaseCandidate(
    process.cwd(),
    process.argv[3],
  );
  console.log(
    JSON.stringify({
      status: "passed",
      version: manifest.version,
      sha256: manifest.sha256,
      publicationAuthorized: false,
      publicLaunch: "NO-GO",
    }),
  );
} catch {
  console.error(
    "RC verification failed: check path, exact artifact, manifest and recorded evidence. No package was executed.",
  );
  process.exitCode = 2;
}
