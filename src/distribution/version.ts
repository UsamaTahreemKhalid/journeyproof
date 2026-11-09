import { InputError } from "../shared/errors.js";

// Exact SemVer without build metadata: npm strips build metadata when publishing.
const releaseVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;
export function assertReleaseVersion(
  version: unknown,
): asserts version is string {
  if (
    typeof version !== "string" ||
    version.length > 50 ||
    !releaseVersion.test(version) ||
    version
      .split("-", 1)[0]!
      .split(".")
      .some((part) => !Number.isSafeInteger(Number(part)))
  )
    throw new InputError("Invalid release version");
}
export function releaseFilename(version: unknown) {
  assertReleaseVersion(version);
  return `journeyproof-${version}.tgz`;
}
export function assertNpmStagingVersion(version: unknown): void {
  if (
    typeof version !== "string" ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)
  )
    throw new InputError("Invalid npm CLI version");
  const parts = version.split(".").map(Number);
  if (
    parts.some((part) => !Number.isSafeInteger(part)) ||
    parts[0]! < 11 ||
    (parts[0] === 11 && parts[1]! < 15)
  )
    throw new InputError("npm CLI 11.15.0 or newer is required for staging");
}
