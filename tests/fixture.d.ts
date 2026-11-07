declare module "*.mjs" {
  import type { Server } from "node:http";
  export function createDemo(options?: { failApproval?: boolean }): Server;
}
