import http from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function createDemo({ failApproval = false } = {}) {
  const admissions = new Map();
  const sessions = new Set();
  let nextId = 1;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (status, body, type = "text/html; charset=utf-8") => {
      res.writeHead(status, {
        "content-type": type,
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
        "x-content-type-options": "nosniff",
      });
      res.end(body);
    };
    const redirect = (path) => {
      res.writeHead(303, { location: path });
      res.end();
    };
    const html = (title, content) =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · Admissions Demo</title><style>body{font:17px/1.6 system-ui;margin:0;color:#14263b;background:#f2f5fa}main{max-width:850px;margin:60px auto;padding:36px;background:white;border-radius:14px}label{display:block;margin:20px 0}input{display:block;width:95%;padding:12px;font:inherit}button,a{font:inherit}button{padding:12px 22px;background:#075ea3;color:white;border:0;border-radius:6px;cursor:pointer}a{color:#075ea3}table{width:100%;text-align:left}td,th{padding:12px}header{color:#48617a;letter-spacing:.08em}p[role=alert]{color:#a31828}</style></head><body><main><header>JOURNEYPROOF / SYNTHETIC ADMISSIONS FIXTURE</header>${content}</main></body></html>`;
    const body = async () => {
      let data = "";
      for await (const chunk of req) {
        data += chunk;
        if (data.length > 8192) throw new Error("Request too large");
      }
      return new URLSearchParams(data);
    };
    try {
      if (url.pathname === "/health") return send(200, "ok", "text/plain");
      if (url.pathname === "/client.js")
        return send(
          200,
          `const button=document.querySelector('[data-approve]');if(button)button.addEventListener('click',async()=>{button.disabled=true;const r=await fetch(button.dataset.approve,{method:'POST'});if(r.ok){document.querySelector('[role=status]').textContent='Approved';button.remove()}else{document.querySelector('[role=alert]').textContent='Approval failed: server returned HTTP '+r.status;button.disabled=false}});`,
          "text/javascript",
        );
      if (url.pathname === "/login" && req.method === "GET")
        return send(
          200,
          html(
            "Sign in",
            '<h1>Sign in</h1><form method="post" action="/login"><label>Email<input type="email" name="email" required autocomplete="off"></label><label>Password<input type="password" name="password" required autocomplete="off"></label><button>Sign in</button></form>',
          ),
        );
      if (url.pathname === "/login" && req.method === "POST") {
        const form = await body();
        if (
          form.get("email") !== "officer@example.test" ||
          form.get("password") !== "fictional-demo-password"
        )
          return send(401, html("Sign in failed", "<h1>Sign in failed</h1>"));
        const session = randomUUID();
        sessions.add(session);
        res.setHeader(
          "set-cookie",
          `demo_session=${session}; HttpOnly; SameSite=Strict; Path=/`,
        );
        return redirect("/admissions");
      }
      // This is a fixture, not production authentication.
      const session = /(?:^|; )demo_session=([^;]+)/.exec(
        req.headers.cookie ?? "",
      )?.[1];
      if (!sessions.has(session)) return redirect("/login");
      if (url.pathname === "/admissions" && req.method === "GET")
        return send(
          200,
          html(
            "Admissions",
            `<h1>Admissions</h1><p><a href="/guide?token=fictional-query-token">Admissions guide</a></p><a href="/admissions/new">Create admission</a><table><thead><tr><th>Applicant</th><th>Status</th><th>Details</th></tr></thead><tbody>${[...admissions.values()].map((a) => `<tr><td>${escape(a.name)}</td><td>${a.status}</td><td><a href="/admissions/${a.id}">View admission ${a.id}</a></td></tr>`).join("")}</tbody></table>`,
          ),
        );
      if (url.pathname === "/guide" && req.method === "GET")
        return send(
          200,
          html(
            "Admissions guide",
            '<h1>Admissions guide</h1><p>Fictional workflow guidance. Role labels do not establish permissions.</p><a href="/admissions">Back to admissions</a>',
          ),
        );
      if (url.pathname === "/admissions/new" && req.method === "GET")
        return send(
          200,
          html(
            "Create admission",
            '<h1>Create admission</h1><form action="/admissions" method="post"><label>Applicant name<input name="name" required maxlength="100"></label><label>Applicant email<input name="email" type="email" required maxlength="200"></label><button>Submit admission</button></form>',
          ),
        );
      if (url.pathname === "/admissions" && req.method === "POST") {
        const form = await body();
        const name = form.get("name")?.trim();
        const email = form.get("email")?.trim();
        if (
          !name ||
          name.length > 100 ||
          !email ||
          email.length > 200 ||
          !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
        )
          return send(
            400,
            html("Invalid admission", "<h1>Invalid admission</h1>"),
          );
        const id = String(nextId++);
        admissions.set(id, { id, name, email, status: "Pending" });
        return redirect("/admissions");
      }
      const detail = /^\/admissions\/(\d+)$/.exec(url.pathname);
      if (detail && req.method === "GET") {
        const a = admissions.get(detail[1]);
        if (!a) return send(404, "Not found");
        return send(
          200,
          html(
            "Admission details",
            `<h1>Admission details</h1><h2>${escape(a.name)}</h2><p>${escape(a.email)}</p><p role="status" data-testid="admission-status">${a.status}</p><p role="alert"></p>${a.status === "Pending" ? `<button data-approve="/api/admissions/${a.id}/approve">Approve admission</button>` : ""}<p><a href="/admissions">Back to admissions</a></p><script src="/client.js"></script>`,
          ),
        );
      }
      const approval = /^\/api\/admissions\/(\d+)\/approve$/.exec(url.pathname);
      if (approval && req.method === "POST") {
        const a = admissions.get(approval[1]);
        if (!a) return send(404, "{}", "application/json");
        if (failApproval)
          return send(
            500,
            JSON.stringify({ error: "Synthetic approval failure" }),
            "application/json",
          );
        a.status = "Approved";
        return send(
          200,
          JSON.stringify({ status: a.status }),
          "application/json",
        );
      }
      send(404, "Not found");
    } catch {
      send(400, "Invalid request", "text/plain");
    }
  });
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failApproval =
    process.env.DEMO_FAIL_APPROVAL === "1" ||
    process.argv.includes("--fail-approval");
  const server = createDemo({ failApproval });
  server.listen(Number(process.env.PORT ?? 4173), "127.0.0.1", () =>
    console.log(
      `Admissions demo: http://127.0.0.1:${server.address().port} (approval ${failApproval ? "HTTP 500" : "healthy"})`,
    ),
  );
  const stop = () => server.close();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
