#!/usr/bin/env node
import { main } from "./main.js";
const controller = new AbortController();
const interrupt = () => controller.abort();
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
process.exitCode = await main(
  process.argv.slice(2),
  undefined,
  controller.signal,
);
process.removeListener("SIGINT", interrupt);
process.removeListener("SIGTERM", interrupt);
