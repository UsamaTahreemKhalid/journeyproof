import { it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Page, Route } from "playwright";
import {
  authorizedUrl,
  guardRedirects,
  OriginPolicyError,
} from "../../src/engine/origin-guard.js";
const origin = "http://127.0.0.1:4173";

it.each([
  ["/local", origin, true],
  ["//127.0.0.1:4173/a", origin, true],
  ["http://127.0.0.1:4173/a?fixture=1", origin, true],
  ["http://%31%32%37.0.0.1:4173/", origin, true],
  ["https://EXAMPLE.test:443/a", "https://example.test", true],
  ["http://example.test:80/", "http://example.test", true],
  ["http://[0:0:0:0:0:0:0:1]:4173/", "http://[::1]:4173", true],
  ["http://127.0.0.1:4174/", origin, false],
  ["https://127.0.0.1:4173/", origin, false],
  ["http://localhost:4173/", origin, false],
  ["http://127.0.0.1.evil.test:4173/", origin, false],
  ["http://fixture:fixture@127.0.0.1:4173/", origin, false],
  ["http://[invalid", origin, false],
  ["data:text/html,fixture", origin, false],
  ["javascript:void(0)", origin, false],
  ["file:///synthetic", origin, false],
])(
  "compares normalized HTTP origins without prefix authorization: %s",
  (value, base, allowed) => {
    expect(authorizedUrl(value as string, base as string)).toBe(allowed);
  },
);
function mockPage() {
  let closed = false,
    stopping = false;
  const session = Object.assign(new EventEmitter(), {
    send: vi.fn().mockResolvedValue({}),
  });
  let routeHandler!: (route: Route) => Promise<void>;
  const context = {
    route: vi.fn(async (_pattern, handler) => {
      routeHandler = handler;
    }),
    routeWebSocket: vi.fn(async () => {}),
    newCDPSession: vi.fn(async () => session),
    close: vi.fn(async () => {
      closed = true;
    }),
  };
  const mainFrame = { url: () => origin };
  const page = Object.assign(new EventEmitter(), {
    context: () => context,
    isClosed: () => closed,
    mainFrame: () => mainFrame,
    close: vi.fn(async () => {
      closed = true;
    }),
  });
  return {
    page: page as unknown as Page,
    emitter: page,
    context,
    session,
    mainFrame,
    stopping: () => stopping,
    stop: () => {
      stopping = true;
    },
    pause: async (event: Record<string, unknown>) => {
      const callback = session.listeners("Fetch.requestPaused")[0] as (
        event: Record<string, unknown>,
      ) => Promise<void>;
      await callback(event);
    },
    route: async (
      url: string,
      navigation: boolean,
      primary: boolean | "missing",
    ) => {
      const r = {
        request: () => ({
          url: () => url,
          isNavigationRequest: () => navigation,
          frame: () => {
            if (primary === "missing") throw Error("No frame");
            return { page: () => (primary ? page : {}) };
          },
        }),
        continue: vi.fn(async () => {}),
        abort: vi.fn(async () => {}),
      };
      await routeHandler(r as unknown as Route);
      return r;
    },
  };
}
it("fails closed when CDP/Fetch installation is unavailable without echoing browser diagnostics", async () => {
  for (const stage of ["session", "enable", "websocket"]) {
    const f = mockPage();
    if (stage === "session")
      f.context.newCDPSession.mockRejectedValueOnce(
        Error("private browser detail"),
      );
    if (stage === "enable")
      f.session.send.mockRejectedValueOnce(Error("private browser detail"));
    if (stage === "websocket")
      f.context.routeWebSocket.mockRejectedValueOnce(
        Error("private browser detail"),
      );
    await expect(guardRedirects(f.page, origin)).rejects.toMatchObject({
      code: "INTERCEPTION_UNAVAILABLE",
    });
    expect(f.context.close).toHaveBeenCalledOnce();
  }
  expect(
    new OriginPolicyError("INTERCEPTION_UNAVAILABLE").message,
  ).not.toContain("private browser detail");
});
it("fails closed on protocol command errors and unexpected interceptor disconnection", async () => {
  for (const event of ["command", "close"]) {
    const f = mockPage(),
      guard = await guardRedirects(f.page, origin);
    if (event === "command") {
      f.session.send.mockRejectedValueOnce(Error("synthetic"));
      await f.pause({
        requestId: "one",
        resourceType: "Document",
        request: { url: origin + "/" },
      });
    } else f.session.emit("close");
    expect((await guard.blocked).code).toBe("INTERCEPTION_UNAVAILABLE");
    expect(f.context.close).toHaveBeenCalledOnce();
  }
});
it("allows native request/response continuation and rejects ambiguous redirect headers", async () => {
  const f = mockPage(),
    guard = await guardRedirects(f.page, origin);
  await f.pause({
    requestId: "request",
    resourceType: "Document",
    request: { url: origin + "/" },
  });
  await f.pause({
    requestId: "response",
    resourceType: "Document",
    responseStatusCode: 302,
    responseHeaders: [{ name: "Location", value: "/ok" }],
    request: { url: origin + "/" },
  });
  expect(f.session.send).toHaveBeenCalledWith("Fetch.continueRequest", {
    requestId: "request",
  });
  expect(f.session.send).toHaveBeenCalledWith("Fetch.continueResponse", {
    requestId: "response",
  });
  expect(guard.failure()).toBeUndefined();
  await f.pause({
    requestId: "ambiguous",
    resourceType: "Document",
    responseStatusCode: 302,
    responseHeaders: [
      { name: "Location", value: "/ok" },
      { name: "location", value: "/other" },
    ],
    request: { url: origin + "/" },
  });
  expect(guard.failure()?.code).toBe("REDIRECT_DENIED_BEFORE_REQUEST");
  expect(f.session.send).toHaveBeenCalledWith("Fetch.failRequest", {
    requestId: "ambiguous",
    errorReason: "BlockedByClient",
  });
});
it("blocks first popup/frame-less requests and external resources without broadening the resource policy", async () => {
  const f = mockPage(),
    guard = await guardRedirects(f.page, origin);
  const main = await f.route(origin, true, true);
  expect(main.continue).toHaveBeenCalledOnce();
  const asset = await f.route("http://127.0.0.1:4174/asset", false, true);
  expect(asset.abort).toHaveBeenCalledOnce();
  expect(guard.failure()).toBeUndefined();
  for (const primary of [false, "missing"] as const) {
    const popup = await f.route(origin, true, primary);
    expect(popup.abort).toHaveBeenCalledOnce();
  }
  expect(guard.failure()?.code).toBe("EXTRA_PAGE_BLOCKED_BEFORE_REQUEST");
  const other = mockPage(),
    otherGuard = await guardRedirects(other.page, origin);
  await other.route("http://127.0.0.1:4174/document", true, "missing");
  expect(otherGuard.failure()?.code).toBe("ORIGIN_BLOCKED_BEFORE_REQUEST");
});
it("does not misclassify expected shutdown protocol errors as an interceptor failure", async () => {
  const f = mockPage(),
    guard = await guardRedirects(f.page, origin, f.stopping);
  f.stop();
  f.session.send.mockRejectedValueOnce(Error("closing"));
  await f.pause({
    requestId: "closing",
    resourceType: "Document",
    request: { url: origin + "/" },
  });
  f.session.emit("close");
  expect(guard.failure()).toBeUndefined();
});
