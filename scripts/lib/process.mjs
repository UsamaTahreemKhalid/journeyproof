import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
// Node + npm's actual JS entry works on Windows without shell interpolation or .cmd spawning.
export function npm(args, options = {}) {
  const entry = process.env.npm_execpath;
  if (!entry || !/npm-cli\.js$/.test(entry))
    throw new Error(
      "Run this check through npm run so npm_execpath identifies npm-cli.js",
    );
  return execute(process.execPath, [entry, ...args], {
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
}
export function node(args, options = {}) {
  return execute(process.execPath, args, {
    timeout: 90000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
}
