import { readFile, readdir, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { auditReleasePolicy, auditInactivePublisher } from "../dist/index.js";
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const files = (await readdir(".github/workflows")).filter((f) =>
  /\.ya?ml$/.test(f),
);
const policy = auditReleasePolicy(
  metadata,
  await Promise.all(
    files.map((f) => readFile(".github/workflows/" + f, "utf8")),
  ),
);
const publicationDraft = auditInactivePublisher(
  await readFile("tests/fixtures/release/npm-publish.yml.example", "utf8"),
);
async function markdownFiles(directory) {
  const documents = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = directory + "/" + entry.name;
    if (entry.isSymbolicLink())
      throw new Error("Documentation must not contain symlinks: " + path);
    if (entry.isDirectory()) documents.push(...(await markdownFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".md")) documents.push(path);
  }
  return documents;
}
// Audit all maintained docs and Skill references, including files outside npm's
// allowlist. Missing package inputs must fail even when they are not Markdown.
for (const path of metadata.files) await access(resolve(path));
const documents = new Set([
  ...(await readdir(".", { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name),
  ...(await markdownFiles("docs")),
  ...(await markdownFiles("skills")),
  ...(await markdownFiles(".github")),
  ...metadata.files.filter((f) => /^docs\/.*\.(md|json)$/.test(f)),
]);
let checkedLinks = 0;
for (const file of documents) {
  const content = await readFile(file, "utf8");
  for (const link of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = link[1].replace(/^<(.+)>$/, "$1").split("#")[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    const destination = resolve(dirname(file), target);
    await access(destination);
    checkedLinks++;
  }
}
console.log(
  JSON.stringify(
    {
      ...policy,
      publicationDraft,
      checkedLinks,
      documents: documents.size,
      ownerDecisionsPending: [
        "npm distribution authorization",
        "source visibility",
        "name/scope ownership",
        "MCP Registry registration authorization",
        "package access",
        "publisher identity/workflow",
        "explicit publication approval",
      ],
    },
    null,
    2,
  ),
);
// No remote calls; all relative docs links resolve in this checkout. Future external links require owner verification.
