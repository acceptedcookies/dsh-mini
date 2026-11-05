// MN02 公网面探测 —— dsh-mini.haimang.com.cn（NPM→172.31.0.1:9095→fss3）。
// 覆盖：健康面、票据闸、vfs 键区、worker 五端点（state CAS/claim/alarm）、
// artifacts 公网出口、跨 owner 隔离、键形防穿越。
// 用法：BASE=https://dsh-mini.haimang.com.cn TICKET=… TICKET2=… node test/mn02/public-surface.mjs
// 票据由 POD1 /dev/ticket（x-admin-token）铸，两票 oid 不同以验隔离。

const BASE = (process.env.BASE ?? "https://dsh-mini.haimang.com.cn").replace(/\/$/, "");
const T1 = process.env.TICKET ?? "";
const T2 = process.env.TICKET2 ?? "";
if (!T1 || !T2) { console.error("TICKET/TICKET2 required"); process.exit(2); }

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail = "") => {
  const ok = !!cond;
  if (ok) pass++; else fail++;
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s) => Buffer.from(s, "base64").toString("utf8");
const api = (path, { ticket, body, method = "POST" } = {}) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(ticket ? { authorization: `Bearer ${ticket}` } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
const japi = async (p, o) => { const r = await api(p, o); let j = null; try { j = await r.json(); } catch { /* non-json */ } return { status: r.status, j }; };

// ── 健康与鉴权闸 ─────────────────────────────────────────────────────
{
  const r = await fetch(`${BASE}/healthz`);
  const j = await r.json();
  check("healthz 200 ok", r.status === 200 && j.ok === true);
}
{
  const r = await japi("/v1/state/get", { body: { key: "state/x" } });
  check("no-ticket → 401", r.status === 401);
  const r2 = await japi("/v1/vfs/list", { body: { prefix: "vfs/" } });
  check("vfs no-ticket → 401", r2.status === 401);
  const r3 = await japi("/v1/state/get", { ticket: "bad.bad.bad", body: { key: "state/x" } });
  check("bad-ticket → 401", r3.status === 401);
  const r4 = await api("/dev/ticket", { body: { oid: "x" } });
  check("dev/ticket no-admin → 403", r4.status === 403);
}

// ── worker 五端点（ticket1 = owner A）─────────────────────────────────
let etag1;
{
  const r = await japi("/v1/state/put-cas", { ticket: T1, body: { key: "state/mn02-sess", body: "v1-payload" } });
  check("state put-cas create → 200+etag", r.status === 200 && typeof r.j.etag === "string");
  etag1 = r.j.etag;
  const g = await japi("/v1/state/get", { ticket: T1, body: { key: "state/mn02-sess" } });
  check("state get roundtrip", g.status === 200 && g.j.body === "v1-payload");
  const stale = await japi("/v1/state/put-cas", { ticket: T1, body: { key: "state/mn02-sess", body: "v2", cond: { ifMatch: "deadbeef" } } });
  check("state stale ifMatch → 412", stale.status === 412);
  const ok2 = await japi("/v1/state/put-cas", { ticket: T1, body: { key: "state/mn02-sess", body: "v2", cond: { ifMatch: etag1 } } });
  check("state good ifMatch → 200", ok2.status === 200);
  const exists = await japi("/v1/state/put-cas", { ticket: T1, body: { key: "state/mn02-sess", body: "v3", cond: { ifNoneMatch: "*" } } });
  check("state ifNoneMatch on existing → 412", exists.status === 412);
  const big = "x".repeat(257 * 1024);
  const toobig = await japi("/v1/state/put-cas", { ticket: T1, body: { key: "state/big", body: big } });
  check("state >256KB → 413", toobig.status === 413);
  const trav = await japi("/v1/state/put-cas", { ticket: T1, body: { key: "state/../esc", body: "x" } });
  check("state traversal key → 400", trav.status === 400);
  const inj = await japi("/v1/state/put-cas", { ticket: T1, body: { key: "state/inj", body: "mine", openid: "victim" } });
  check("state openid field ignored (write ok)", inj.status === 200);
  const vic = await japi("/v1/state/get", { ticket: T2, body: { key: "state/inj" } });
  check("owner-B cannot read injected row → 404", vic.status === 404);
  const vic2 = await japi("/v1/state/get", { ticket: T2, body: { key: "state/mn02-sess" } });
  check("owner-B cannot read A state → 404", vic2.status === 404);
}
{
  const c1 = await japi("/v1/claim", { ticket: T1, body: { key: "mn02-lease", holder: "h1", ttlMs: 60000 } });
  check("claim acquire → holder", c1.status === 200 && c1.j.holder === "h1");
  const c2 = await japi("/v1/claim", { ticket: T1, body: { key: "mn02-lease", holder: "h2", ttlMs: 60000 } });
  check("claim by other holder → 412", c2.status === 412);
  const c3 = await japi("/v1/claim", { ticket: T1, body: { key: "mn02-lease", holder: "h1", ttlMs: 100 } });
  check("claim re-acquire same holder → 200", c3.status === 200);
}
{
  const dueTs = Date.now() - 1000;
  const akey = `alarms/${dueTs}-sess9`;
  await japi("/v1/state/put-cas", { ticket: T1, body: { key: akey, body: JSON.stringify({ sid: "sess9", due: dueTs }) } });
  const due = await japi("/v1/alarm/due", { ticket: T1, body: { now: Date.now() } });
  check("alarm/due lists due key", due.status === 200 && Array.isArray(due.j.keys) && due.j.keys.includes(akey));
  const dueB = await japi("/v1/alarm/due", { ticket: T2, body: { now: Date.now() } });
  check("alarm/due owner-B empty", dueB.status === 200 && !dueB.j.keys.includes(akey));
  const cl = await japi("/v1/alarm/claim", { ticket: T1, body: { key: `${dueTs}-sess9`, holder: "sweeper" } });
  check("alarm/claim returns body", cl.status === 200 && typeof cl.j.body === "string");
  const cl2 = await japi("/v1/alarm/claim", { ticket: T1, body: { key: `${dueTs}-sess9`, holder: "sweeper" } });
  check("alarm/claim twice → 404 (at-most-once consume)", cl2.status === 404);
}

// ── vfs 键区 ─────────────────────────────────────────────────────────
{
  const p = await japi("/v1/vfs/put", { ticket: T1, body: { key: "vfs/ws1/hello.txt", bytes_b64: b64("hello fss3"), mime: "text/plain" } });
  check("vfs put → etag", p.status === 200 && typeof p.j.etag === "string");
  const g = await japi("/v1/vfs/get", { ticket: T1, body: { key: "vfs/ws1/hello.txt" } });
  check("vfs get roundtrip", g.status === 200 && unb64(g.j.body_b64) === "hello fss3");
  const l = await japi("/v1/vfs/list", { ticket: T1, body: { prefix: "vfs/ws1/" } });
  check("vfs list contains key", l.status === 200 && l.j.keys.includes("vfs/ws1/hello.txt"));
  const lB = await japi("/v1/vfs/list", { ticket: T2, body: { prefix: "vfs/" } });
  check("owner-B vfs list isolated", lB.status === 200 && !lB.j.keys.includes("vfs/ws1/hello.txt"));
  const gB = await japi("/v1/vfs/get", { ticket: T2, body: { key: "vfs/ws1/hello.txt" } });
  check("owner-B vfs get → 404", gB.status === 404);
  const trav = await japi("/v1/vfs/put", { ticket: T1, body: { key: "vfs/../esc", bytes_b64: b64("x") } });
  check("vfs traversal put → 400", trav.status === 400);
  const trav2 = await japi("/v1/vfs/list", { ticket: T1, body: { prefix: "vfs//" } });
  check("vfs bad prefix → 400", trav2.status === 400);
  const mismatch = await japi("/v1/vfs/put", { ticket: T1, body: { key: "vfs/ws1/mm", bytes_b64: b64("x"), sha256: "0".repeat(64) } });
  check("vfs sha256 mismatch → 400", mismatch.status === 400);
  const dup = await japi("/v1/vfs/put", { ticket: T1, body: { key: "vfs/ws1/hello.txt", bytes_b64: b64("again"), if_none_match: true } });
  check("vfs if_none_match existing → 412", dup.status === 412);
  // range get
  const rg = await japi("/v1/vfs/get", { ticket: T1, body: { key: "vfs/ws1/hello.txt", offset: 6, max_bytes: 4 } });
  check("vfs range get", rg.status === 200 && unb64(rg.j.body_b64) === "fss3");
  const d = await japi("/v1/vfs/del", { ticket: T1, body: { key: "vfs/ws1/hello.txt" } });
  check("vfs del → removed", d.status === 200 && d.j.removed === true);
  const g2 = await japi("/v1/vfs/get", { ticket: T1, body: { key: "vfs/ws1/hello.txt" } });
  check("vfs get after del → 404", g2.status === 404);
}

// ── artifacts 公网出口 ───────────────────────────────────────────────
{
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04]);
  const pub = await japi("/v1/artifacts/publish", { ticket: T1, body: { bytes_b64: png.toString("base64"), mime: "image/png" } });
  check("artifacts publish → sha256+url", pub.status === 200 && /^[0-9a-f]{64}$/.test(pub.j.sha256 ?? "") && typeof pub.j.url === "string");
  if (pub.j.url) {
    const get = await fetch(pub.j.url);
    const buf = Buffer.from(await get.arrayBuffer());
    check("public artifact GET no-auth roundtrip", get.status === 200 && buf.equals(png));
    check("artifact immutable cache header", /immutable/.test(get.headers.get("cache-control") ?? ""));
  }
  const bad = await fetch(`${BASE}/a/${"0".repeat(64)}`);
  check("unknown artifact → 404", bad.status === 404);
  const nons = await fetch(`${BASE}/a/nothex`);
  check("non-hex artifact path → 404", nons.status === 404);
}

console.log(results.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
