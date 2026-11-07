import { InputError } from "./errors.js";
export function safePath(value: string, pattern = false): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    (pattern ? /^\/[a-zA-Z0-9/_.\-*]*$/ : /^\/[a-zA-Z0-9/_.-]*$/).test(value) &&
    !value
      .split("/")
      .some(
        (part) =>
          part === "." || part === ".." || (part.match(/\*/g)?.length ?? 0) > 1,
      )
  );
}
export function pathMatches(pattern: string, path: string): boolean {
  const segments = pattern.split("/");
  const actual = path.split("/");
  return (
    segments.length === actual.length &&
    segments.every((part, i) => {
      const star = part.indexOf("*");
      const target = actual[i]!;
      return star < 0
        ? part === target
        : target.length >= part.length - 1 &&
            target.startsWith(part.slice(0, star)) &&
            target.endsWith(part.slice(star + 1));
    })
  );
}
export function baseOrigin(value: string, allowRemote = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InputError("Invalid base URL; use http://127.0.0.1:4173");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new InputError(
      "Base URL must be an HTTP(S) origin without credentials, query, fragment or path",
    );
  if (
    !allowRemote &&
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new InputError(
      "Remote target requires explicit --allow-remote authorization",
    );
  return url.origin;
}
export function redact(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret)
      for (const variant of new Set([secret, encodeURIComponent(secret)]))
        result = result.split(variant).join("[REDACTED]");
  }
  return result.replace(/https?:\/\/[^\s"'<>]+/g, (raw) => {
    try {
      const url = new URL(raw);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return "[URL]";
    }
  });
}
export function safeUrl(value: string): string {
  try {
    const u = new URL(value);
    return u.origin + u.pathname;
  } catch {
    return "[invalid URL]";
  }
}
export function redactObject<T>(value: T, secrets: readonly string[]): T {
  if (typeof value === "string") return redact(value, secrets) as T;
  if (Array.isArray(value))
    return value.map((v) => redactObject(v, secrets)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactObject(v, secrets)]),
    ) as T;
  return value;
}
export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
