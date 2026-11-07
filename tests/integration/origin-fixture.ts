import { createServer } from "node:http";
import { once, EventEmitter } from "node:events";
import type { Journey } from "../../src/config/schema.js";

export const flow = (path: string): Journey => ({
  schemaVersion: 1,
  name: "Synthetic origin boundary",
  steps: [
    { id: "open", action: "goto", path },
    {
      id: "ready",
      action: "expectVisible",
      locator: { role: "heading", name: "Ready" },
    },
  ],
});
export async function originFixture(host: "127.0.0.1" | "::1" = "127.0.0.1") {
  const hostname = host === "::1" ? "[::1]" : host;
  const forbidden: { method: string; path: string }[] = [];
  const approved: { method: string; path: string }[] = [];
  const events = new EventEmitter();
  let upgrades = 0;
  let sessionSeen = false;
  const sink = createServer((req, res) => {
    forbidden.push({
      method: req.method!,
      path: new URL(req.url!, "http://127.0.0.1").pathname,
    });
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end("<h1>Ready</h1>");
  });
  sink.listen(0, host);
  await once(sink, "listening");
  const sinkAddress = sink.address();
  if (!sinkAddress || typeof sinkAddress === "string")
    throw Error("Fixture port missing");
  const forbiddenOrigin = `http://${hostname}:${sinkAddress.port}`;
  let origin = "";
  const app = createServer((req, res) => {
    const path = new URL(req.url!, "http://127.0.0.1").pathname;
    approved.push({ method: req.method!, path });
    events.emit(path);
    const redirect = (status: number, location?: string) => {
      res.writeHead(status, location === undefined ? {} : { location });
      res.end();
    };
    const html = (body: string) => {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html>" + body);
    };
    if (path.startsWith("/redirect/"))
      return redirect(
        Number(path.split("/")[2]),
        forbiddenOrigin + "/forbidden?token=fictional-query",
      );
    if (path.startsWith("/same/"))
      return redirect(Number(path.split("/")[2]), "/ok");
    if (path === "/chain") return redirect(302, "/redirect/302");
    if (path === "/relative") return redirect(302, "./ok");
    if (path === "/protocol-relative")
      return redirect(302, forbiddenOrigin.replace("http:", "") + "/forbidden");
    if (path === "/encoded")
      return redirect(
        302,
        forbiddenOrigin.replace("127.0.0.1", "%31%32%37.0.0.1") + "/forbidden",
      );
    if (path === "/hostname")
      return redirect(
        302,
        forbiddenOrigin.replace("127.0.0.1", "localhost") + "/forbidden",
      );
    if (path === "/protocol")
      return redirect(
        302,
        forbiddenOrigin.replace("http:", "https:") + "/forbidden",
      );
    if (path === "/credentials")
      return redirect(
        302,
        origin.replace("http://", "http://fixture:fixture@") + "/ok",
      );
    if (path === "/malformed") return redirect(302, "http://[invalid");
    if (path === "/missing") return redirect(302);
    if (path === "/empty") return redirect(302, "");
    if (path === "/scheme") return redirect(302, "data:text/html,fixture");
    if (path === "/slow") return; // Client cancellation closes this disposable socket.
    if (path === "/script")
      return html(
        `<script>window.location=${JSON.stringify(forbiddenOrigin + "/forbidden")}</script><h1>Ready</h1>`,
      );
    if (path === "/meta")
      return html(
        `<meta http-equiv="refresh" content="0; url=${forbiddenOrigin}/forbidden"><h1>Ready</h1>`,
      );
    if (path === "/spa")
      return html(
        "<h1>Ready</h1><button onclick=\"history.pushState({},'','/spa-done')\">Navigate</button>",
      );
    if (path === "/anchor")
      return html(
        `<h1>Ready</h1><a href="${forbiddenOrigin}/forbidden">Leave</a>`,
      );
    if (path === "/popup-blank")
      return html(
        `<h1>Ready</h1><button onclick='const child=window.open("about:blank");child.location=${JSON.stringify(forbiddenOrigin + "/forbidden")}'>Popup</button>`,
      );
    if (path.startsWith("/popup"))
      return html(
        `<h1>Ready</h1><button onclick='window.open(${JSON.stringify(path === "/popup-redirect" ? "/redirect/302" : path === "/popup-same" ? "/ok" : forbiddenOrigin + "/forbidden")})'>Popup</button>`,
      );
    if (path.startsWith("/iframe")) {
      const target =
        path === "/iframe"
          ? forbiddenOrigin + "/forbidden"
          : path === "/iframe-host"
            ? "/hostname"
            : path === "/iframe-same"
              ? "/same/302"
              : "/redirect/302";
      return html(`<h1>Ready</h1><iframe src="${target}"></iframe>`);
    }
    if (path === "/external-resources")
      return html(
        `<h1>Ready</h1><img src="${forbiddenOrigin}/image"><script src="${forbiddenOrigin}/script"></script><link rel="stylesheet" href="${forbiddenOrigin}/style">`,
      );
    if (path === "/local-resources")
      return html(
        '<script src="/asset.js"></script><link rel="stylesheet" href="/asset.css"><h1>Ready</h1>',
      );
    if (path === "/asset.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end("window.fixtureAssetLoaded=true");
    }
    if (path === "/asset.css") {
      res.setHeader("Content-Type", "text/css");
      return res.end("body{color:green}");
    }
    if (path === "/sw")
      return html(
        '<h1>Ready</h1><script>navigator.serviceWorker.register("/worker.js").catch(()=>{});window.workerAttempted=true</script>',
      );
    if (path === "/worker.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end('self.addEventListener("fetch",()=>{})');
    }
    if (path.startsWith("/form-cross/"))
      return html(
        `<form method="POST" action="/post-cross/${path.split("/")[2]}"><input name="fixture" value="synthetic"><button>Send</button></form>`,
      );
    if (path.startsWith("/post-cross/")) {
      req.resume();
      return redirect(
        Number(path.split("/")[2]),
        forbiddenOrigin + "/forbidden",
      );
    }
    if (path.startsWith("/form/")) {
      res.setHeader(
        "Set-Cookie",
        "fixture_session=synthetic; HttpOnly; SameSite=Strict; Path=/",
      );
      return html(
        `<form method="POST" action="/post/${path.split("/")[2]}"><input name="fixture" value="synthetic"><button>Send</button></form>`,
      );
    }
    if (path.startsWith("/post/")) {
      req.resume();
      return redirect(Number(path.split("/")[2]), "/landing");
    }
    if (path === "/landing") {
      req.resume();
      sessionSeen = Boolean(req.headers.cookie?.includes("fixture_session="));
    }
    return html("<h1>Ready</h1>");
  });
  app.on("upgrade", (_req, socket) => {
    upgrades++;
    socket.destroy();
  });
  app.listen(0, host);
  await once(app, "listening");
  const address = app.address();
  if (!address || typeof address === "string")
    throw Error("Fixture port missing");
  origin = `http://${hostname}:${address.port}`;
  return {
    origin,
    forbiddenOrigin,
    forbidden,
    approved,
    upgrades: () => upgrades,
    sessionSeen: () => sessionSeen,
    requested: (path: string) => once(events, path),
    close: async () => {
      app.closeAllConnections();
      sink.closeAllConnections();
      await Promise.all([
        new Promise<void>((r) => app.close(() => r())),
        new Promise<void>((r) => sink.close(() => r())),
      ]);
    },
  };
}
