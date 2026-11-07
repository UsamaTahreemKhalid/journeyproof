import { node } from "./process.mjs";
// Use the current typed source policy before any npm build/pack hook can execute.
// tsx is an existing, pinned development dependency; no stale dist fallback.
export async function preflightPolicy() {
  await node([
    "--import",
    import.meta.resolve("tsx"),
    "--input-type=module",
    "-e",
    `
    import {readFileSync,readdirSync} from 'node:fs';
    import {auditReleasePolicy} from ${JSON.stringify(new URL("../../src/distribution/policy.ts", import.meta.url).href)};
    const pkg=JSON.parse(readFileSync('package.json','utf8'));
    const workflows=readdirSync('.github/workflows').filter(f=>/\\.ya?ml$/.test(f)).map(f=>readFileSync('.github/workflows/'+f,'utf8'));
    auditReleasePolicy(pkg,workflows);
  `,
  ]);
}
