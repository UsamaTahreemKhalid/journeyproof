import { createHash } from "node:crypto";
import { z } from "zod";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 20);
export const roleSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(64);
export const hintSchema = z
  .string()
  .max(200)
  .regex(/^\/(?:[a-z][a-z-]{0,30}|:id)(?:\/(?:[a-z][a-z-]{0,30}|:id))*$|^\/$/);
export const routeSchema = z.strictObject({
  key: z.string().regex(/^[a-f0-9]{20}$/),
  path: z.string().min(1).max(500),
  basis: z.enum(["exact", "hint", "redacted"]),
});
export type Route = z.infer<typeof routeSchema>;
export function safeToken(value: string) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : "withheld";
}
export function safeName(value: string) {
  return /^[a-z][a-z0-9 -]{0,63}$/.test(value)
    ? value
    : "workflow-" + digest(value);
}
export function routeFor(
  value: string,
  origin: string,
  hints: readonly string[] = [],
  secrets: readonly string[] = [],
): Route | undefined {
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.pathname.length > 1000
  )
    return;
  const pathname = url.pathname;
  const parts = pathname.split("/");
  const containsSecret = (text: string) =>
    secrets.some(
      (secret) =>
        secret &&
        (text.includes(secret) || text.includes(encodeURIComponent(secret))),
    );
  for (const hint of hints) {
    const wanted = hint.split("/");
    if (
      !containsSecret(hint) &&
      wanted.length === parts.length &&
      wanted.every((part, i) =>
        part === ":id" ? Boolean(parts[i]) : part === parts[i],
      )
    )
      return { key: digest("hint:" + hint), path: hint, basis: "hint" };
  }
  let hidden = false;
  const path = parts
    .map((part, i) => {
      if (!i || !part) return part;
      if (/^[a-z][a-z-]{0,30}$/.test(part) && !containsSecret(part))
        return part;
      hidden = true;
      return "segment-" + digest(part).slice(0, 8);
    })
    .join("/");
  if (path.length > 500)
    return {
      key: digest("exact:" + pathname),
      path: "/redacted-route-" + digest(pathname),
      basis: "redacted",
    };
  return {
    key: digest("exact:" + pathname),
    path,
    basis: hidden ? "redacted" : "exact",
  };
}
export function safeReason(reason?: string) {
  const match = reason?.match(
    /^Expected HTTP ([1-5][0-9]{2}); observed HTTP ([1-5][0-9]{2})(?: for |\.?$)/,
  );
  if (match) return `Expected HTTP ${match[1]}; observed HTTP ${match[2]}.`;
  if (reason?.includes("interrupted"))
    return "Run interrupted or deadline exceeded.";
  if (reason?.startsWith("Navigation returned HTTP "))
    return reason.slice(0, 28).replace(/[^a-zA-Z0-9 .]/g, "");
  return "Configured assertion or browser operation failed; inspect approved local evidence.";
}
