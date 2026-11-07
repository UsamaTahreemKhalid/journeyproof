export class InputError extends Error {
  override name = "InputError";
  diagnostics?: { path: string; code: string }[];
}
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function exitCode(status: "passed" | "failed" | "error"): number {
  return status === "passed" ? 0 : status === "failed" ? 1 : 2;
}
