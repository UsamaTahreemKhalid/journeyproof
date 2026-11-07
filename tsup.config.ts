import { defineConfig } from "tsup";
export default defineConfig({
  entry: {
    cli: "src/cli/bin.ts",
    index: "src/index.ts",
    testing: "src/regression/runtime.ts",
  },
  format: ["esm"],
  target: "node24",
  clean: true,
  splitting: false,
  dts: false,
});
