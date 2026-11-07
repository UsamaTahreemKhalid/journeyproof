import type { Page } from "playwright";

// Chromium Fetch pauses every request, including redirect hops that normal
// Playwright route handlers do not revisit. MCP enables this extra boundary.
export async function guardRedirects(page: Page, origin: string) {
  const session = await page.context().newCDPSession(page);
  session.on("Fetch.requestPaused", async (event) => {
    try {
      if (new URL(event.request.url).origin === origin)
        await session.send("Fetch.continueRequest", {
          requestId: event.requestId,
        });
      else
        await session.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
    } catch {
      /* Closing the context cancels paused requests; never continue on error. */
    }
  });
  await session.send("Fetch.enable", {
    patterns: [{ urlPattern: "*", requestStage: "Request" }],
  });
}
