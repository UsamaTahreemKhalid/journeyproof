export const EXAMPLE_YAML = `# JourneyProof v1. Run only against an application you own or may test.
schemaVersion: 1
name: first-journey
baseUrl: http://127.0.0.1:4173
steps:
  - id: open-login
    action: goto
    path: /login
  - id: login-visible
    action: expectVisible
    locator: { role: heading, name: Sign in }
`;
