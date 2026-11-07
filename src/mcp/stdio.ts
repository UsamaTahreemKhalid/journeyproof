import type { Transport } from "@modelcontextprotocol/server";
import {
  StdioServerTransport,
  serveStdio,
} from "@modelcontextprotocol/server/stdio";
import { createJourneyProofServer } from "./server.js";
import { WorkspacePolicy } from "./policy.js";

export async function startStdio(
  signal?: AbortSignal,
  providedTransport?: Transport,
) {
  if (signal?.aborted) return;
  const policy = await WorkspacePolicy.create();
  const instances: Awaited<ReturnType<typeof createJourneyProofServer>>[] = [];
  const transport =
    providedTransport ??
    new StdioServerTransport(process.stdin, process.stdout, {
      maxBufferSize: 64 * 1024,
    });
  let finish!: () => void;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const handle = serveStdio(
    async () => {
      const instance = await createJourneyProofServer({
        workspaceRoot: policy.root,
        flowDirectory: policy.flowDirectory,
        signal,
      });
      instances.push(instance);
      return instance.server;
    },
    {
      transport,
      onerror: () => {
        process.stderr.write(
          "JourneyProof MCP protocol operation failed; check client configuration.\n",
        );
      },
    },
  );
  const priorClose = transport.onclose;
  transport.onclose = () => {
    priorClose?.();
    finish();
  };
  const stop = () => {
    void handle.close();
  };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    if (signal?.aborted) stop();
    await closed;
  } finally {
    signal?.removeEventListener("abort", stop);
    await handle.close();
    await Promise.all(instances.map((instance) => instance.close()));
  }
}
