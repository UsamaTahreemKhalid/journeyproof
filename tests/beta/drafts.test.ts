import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { auditInactivePublisher } from "../../src/distribution/drafts.js";
it("validates the actual inactive cache-disabled pinned publication draft", async () => {
  const text = await readFile(
    "tests/fixtures/release/npm-publish.yml.example",
    "utf8",
  );
  expect(auditInactivePublisher(text)).toEqual({
    inactive: true,
    publicationAuthorized: false,
    releaseCache: false,
  });
});
it("rejects enabled publishing, cache defaults, credentials, unsafe actions and masked failure", async () => {
  const text = await readFile(
    "tests/fixtures/release/npm-publish.yml.example",
    "utf8",
  );
  for (const bad of [
    text.replace("      - run: npm run rc:prepare\n", ""),
    text.replace(
      "package-manager-cache: false",
      "package-manager-cache: false\n          token: forbidden",
    ),
    "null",
    "x: [",
    text + "\non: push\n",
    text.replace("workflow_dispatch", "push"),
    text.replace("${{ false }}", "${{ true }}"),
    text.replace("package-manager-cache: false", "package-manager-cache: true"),
    text.replace("          package-manager-cache: false\n", ""),
    text.replace("node-version: 24", "node-version: 22"),
    text.replace(
      "package-manager-cache: false",
      "package-manager-cache: false\n          cache: npm",
    ),
    text.replace("npm ci", "npm publish"),
    text.replace("npm ci", "npm ci || true"),
    text.replace("npm ci", "echo unexpected"),
    text.replace(
      "      - run: npm ci",
      "      - run: npm ci\n        env: {NODE_AUTH_TOKEN: forbidden}",
    ),
    text.replace(/actions\/checkout@[a-f0-9]{40}/, "actions/checkout@main"),
    text.replace("OWNER_UNSELECTED_PROTECTED_ENVIRONMENT", "production"),
    text.replace("contents: read", "contents: write"),
    text.replace(
      / {6}- uses: actions\/setup-node@[a-f0-9]{40}\n {8}with:\n {10}node-version: 24\n {10}package-manager-cache: false\n/,
      "",
    ),
    text.replace(/ {6}- uses: actions\/checkout@[a-f0-9]{40}\n/, ""),
    text.replace(
      /( {6}- uses: actions\/checkout@[a-f0-9]{40})/,
      "$1\n        with: {token: forbidden}",
    ),
  ])
    expect(() => auditInactivePublisher(bad)).toThrow("Unsafe or invalid");
});
