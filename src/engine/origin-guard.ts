import type { Page } from "playwright";
import type { SecurityCode } from "../shared/types.js";

export const securityMessage = (code: SecurityCode): string =>
  ({
    EXTRA_PAGE_BLOCKED_BEFORE_REQUEST:
      "Security policy blocked an extra page before its HTTP requests; one-page journeys only.",
    ORIGIN_BLOCKED_BEFORE_REQUEST:
      "Security policy blocked an unauthorized destination origin before request dispatch. Use the approved application origin.",
    REDIRECT_DENIED_BEFORE_REQUEST:
      "Security policy blocked an invalid or unauthorized redirect destination before request dispatch.",
    BROWSER_NAVIGATION_FAILED:
      "Browser failed navigation; check the approved application. This failure alone does not prove pre-request isolation.",
    INTERCEPTION_UNAVAILABLE:
      "Security interception unavailable; browser execution stopped without a routing-only fallback.",
    NAVIGATION_DENIED_AFTER_COMMIT:
      "Security policy denied navigation after document commit; this is not evidence of pre-request isolation.",
  })[code];

export class OriginPolicyError extends Error {
  constructor(readonly code: SecurityCode) {
    super(securityMessage(code));
  }
}

// WHATWG normalization handles protocol/host/default ports/IPv6. Credentials are
// forbidden even when URL.origin would otherwise match. Never log raw URLs.
export function authorizedUrl(value: string, origin: string, base = origin) {
  try {
    const url = new URL(value, base);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.origin === new URL(origin).origin
    );
  } catch {
    return false;
  }
}

// Chromium's native Fetch interception pauses every HTTP redirect hop. Requests
// are continued exactly once by the browser: no route.fetch(), cookie proxy,
// response fulfillment, manual redirect following or replay of non-idempotent data.
export async function guardRedirects(
  page: Page,
  origin: string,
  stopping = () => false,
) {
  const context = page.context();
  let failure: OriginPolicyError | undefined;
  let resolveBlocked!: (error: OriginPolicyError) => void;
  const blocked = new Promise<OriginPolicyError>((resolve) => {
    resolveBlocked = resolve;
  });
  const deny = (code: SecurityCode) => {
    if (!failure) {
      failure = new OriginPolicyError(code);
      resolveBlocked(failure);
    }
  };
  try {
    // Context routing covers popup *first* requests, before a page event/session
    // could attach. All extra pages are unsupported, including same-origin ones.
    await context.route("**/*", async (route) => {
      const request = route.request();
      const allowed = authorizedUrl(request.url(), origin);
      let primary = false;
      try {
        primary = request.frame().page() === page;
      } catch {
        // Unavailable initial popup/worker frames are never continued speculatively.
      }
      if (request.isNavigationRequest()) {
        if (!allowed) deny("ORIGIN_BLOCKED_BEFORE_REQUEST");
        else if (!primary) deny("EXTRA_PAGE_BLOCKED_BEFORE_REQUEST");
      }
      try {
        if (allowed && primary) await route.continue();
        else await route.abort("blockedbyclient");
      } catch {
        if (!page.isClosed()) {
          if (!stopping()) deny("INTERCEPTION_UNAVAILABLE");
          await context.close().catch(() => {});
        }
      }
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const session = await context.newCDPSession(page);
    session.on("close", () => {
      if (!page.isClosed()) {
        if (!stopping()) deny("INTERCEPTION_UNAVAILABLE");
        void context.close().catch(() => {});
      }
    });
    session.on("Fetch.requestPaused", async (event) => {
      try {
        if (event.responseErrorReason) {
          if (event.resourceType === "Document" && !stopping())
            deny("BROWSER_NAVIGATION_FAILED");
          await session.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "Failed",
          });
          return;
        }
        const response = event.responseStatusCode !== undefined;
        const redirect =
          response &&
          [301, 302, 303, 307, 308].includes(event.responseStatusCode!);
        let allowed = authorizedUrl(event.request.url, origin);
        if (redirect) {
          const locations = (event.responseHeaders ?? []).filter(
            (header) => header.name.toLowerCase() === "location",
          );
          allowed =
            allowed &&
            locations.length === 1 &&
            Boolean(locations[0]!.value.trim()) &&
            authorizedUrl(locations[0]!.value, origin, event.request.url);
        }
        if (!allowed) {
          if (event.resourceType === "Document")
            deny(
              redirect
                ? "REDIRECT_DENIED_BEFORE_REQUEST"
                : "ORIGIN_BLOCKED_BEFORE_REQUEST",
            );
          await session.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
        } else if (response) {
          await session.send("Fetch.continueResponse", {
            requestId: event.requestId,
          });
        } else {
          await session.send("Fetch.continueRequest", {
            requestId: event.requestId,
          });
        }
      } catch {
        // A broken interceptor must never resume a paused request. Closing the
        // context also cancels requests if the protocol command itself failed.
        if (!page.isClosed()) {
          if (!stopping()) deny("INTERCEPTION_UNAVAILABLE");
          await context.close().catch(() => {});
        }
      }
    });
    await session.send("Fetch.enable", {
      patterns: [
        { urlPattern: "*", requestStage: "Request" },
        { urlPattern: "*", resourceType: "Document", requestStage: "Response" },
      ],
    });
  } catch {
    await context.close().catch(() => {});
    throw new OriginPolicyError("INTERCEPTION_UNAVAILABLE");
  }
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && !authorizedUrl(frame.url(), origin)) {
      deny("NAVIGATION_DENIED_AFTER_COMMIT");
      void page.close().catch(() => {});
    }
  });
  return {
    blocked,
    failure: () => failure,
    extraPage: () => deny("EXTRA_PAGE_BLOCKED_BEFORE_REQUEST"),
  };
}
