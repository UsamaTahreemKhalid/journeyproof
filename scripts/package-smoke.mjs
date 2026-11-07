import { verifyPackage } from "./lib/package-check.mjs";
const options = new Set(process.argv.slice(2));
for (const option of options)
  if (!["--light", "--keep"].includes(option))
    throw new Error("Unknown package-test option");
console.log(
  JSON.stringify(
    await verifyPackage({
      keep: options.has("--keep"),
      light: options.has("--light"),
    }),
    null,
    2,
  ),
);
