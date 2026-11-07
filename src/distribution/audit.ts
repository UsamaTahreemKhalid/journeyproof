import { InputError } from "../shared/errors.js";
export const requiredAssets = [
  "package.json",
  "LICENSE",
  "NOTICE",
  "dist/cli.js",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/testing.js",
  "dist/testing.d.ts",
  "examples/verify-demo.mjs",
  "examples/ci/regression.config.mjs",
  "examples/admissions-demo/app/server.mjs",
  "examples/admissions-demo/journeys/happy-path.yaml",
  "skills/journeyproof/SKILL.md",
  "skills/journeyproof/references/regression-tests.md",
  "docs/MCP_SCHEMAS.json",
  "docs/MAP_SCHEMAS.json",
  "docs/INSTALLATION.md",
  "docs/TROUBLESHOOTING.md",
  "docs/REPORTS.md",
  "docs/assets/demo-comparison.png",
  "docs/assets/demo-failure.png",
  "README.md",
  "SECURITY.md",
];
export function auditManifest(files: { path: string; size: number }[]) {
  if (!files.length || files.length > 200)
    throw new InputError("Package manifest is empty or unexpectedly large");
  const paths = new Set<string>();
  let bytes = 0;
  for (const file of files) {
    if (
      paths.has(file.path) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0
    )
      throw new InputError(
        "Package manifest contains duplicate or invalid entries",
      );
    paths.add(file.path);
    bytes += file.size;
    if (
      !/^(?:dist\/(?:[^/]+\.(?:js|d\.ts)|(?:[a-z-]+\/)+[a-z-]+\.d\.ts)|examples\/(?:admissions-demo\/(?:app\/server\.mjs|journeys\/[a-z-]+\.yaml)|verify-demo\.mjs|ci\/regression\.config\.mjs)|skills\/journeyproof\/(?:SKILL\.md|(?:references|assets)\/[a-z-]+\.md)|docs\/(?:[A-Z_]+\.(?:md|json)|assets\/(?:demo-comparison|demo-failure)\.png)|(?:LICENSE|NOTICE|package\.json|README\.md|SECURITY\.md|CHANGELOG\.md|CONTRIBUTING\.md|CODE_OF_CONDUCT\.md|SUPPORT\.md))$/.test(
        file.path,
      ) ||
      /^docs\/WEEK\d/.test(file.path) ||
      file.path.split("/").some((p) => p === ".." || p.startsWith("."))
    )
      throw new InputError("Unexpected or private file in package manifest");
    if (file.size > 2 * 1024 * 1024)
      throw new InputError("Package file exceeds 2 MiB budget");
  }
  for (const asset of requiredAssets)
    if (!paths.has(asset))
      throw new InputError("Required package asset missing: " + asset);
  if (bytes > 5 * 1024 * 1024)
    throw new InputError("Unpacked package exceeds 5 MiB budget");
  return { files: files.length, unpackedBytes: bytes };
}
export function auditText(text: string) {
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|npm_[A-Za-z0-9]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|\/home\/[^\s/]+\/|\/Users\/[^\s/]+\/|[A-Z]:\\Users\\[^\s\\]+\\/.test(
      text,
    )
  )
    throw new InputError(
      "Private credential or machine path detected in shipped text",
    );
}
