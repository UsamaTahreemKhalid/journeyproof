import { writeFile } from "node:fs/promises";
import { node } from "./lib/process.mjs";
// One ordered TypeScript program, avoiding rollup-dts's shared hashed chunks.
await node([
  "node_modules/typescript/bin/tsc",
  "--project",
  "tsconfig.build.json",
]);
await writeFile(
  "dist/testing.d.ts",
  'export * from "./regression/runtime.js";\n',
);
await writeFile("dist/cli.d.ts", "export {};\n");
