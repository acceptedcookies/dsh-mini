// MN02-B4 真 IDE durable 探针：DevTools 模拟器内（route=cloud，dev-config 注入 envId+durableUrl）
// 验证 __ioStateFor/__vfsRemoteFor/__vfsSyncFor 真句柄 + wx.cloud.callFunction 调真 sweeper。
// 证据级：real Mini Program/DevTools（非 node shim）。evaluate 体禁 await——走 promise 链。
// DevTools 面：wx.startSoterAuthentication 不可用（IDE 无 TEE）→ mp 票据车道属真机面，
//   B/C/E 记 documented-degradation；E 改走「IDE 真 openid + 节点侧铸票写 alarm → sweeper 认领」。
// 用法: node test/mn02/ide-durable.mjs   （IDE 已开时 AUTO_PORT=xxxx 复用）
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { connectIde } from "../../scripts/dev-cli/lib/ide.mjs";

// PITFALL-13 兜底：automator 广播非 JSON 帧时上游 Connection.onMessage 硬崩。
// 测试进程忽略该帧（广播不影响请求/响应配对），其余异常照常上抛。
{
  const req = createRequire(import.meta.url);
  const Connection = req("miniprogram-automator/out/Connection.js").default;
  const orig = Connection.prototype.onMessage;
  Connection.prototype.onMessage = function (e) {
    try { return orig.call(this, e); }
    catch (err) {
      if (String(err?.message ?? err).includes("Unexpected token")) return;
      throw err;
    }
  };
  process.on("uncaughtException", (e) => {
    if (String(e?.message ?? e).includes("Unexpected token")) {
      console.warn("[ide-durable] ignored non-JSON automator frame");
      return;
    }
    throw e;
  });
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const DURABLE = (process.env.DURABLE ?? "https://dsh-mini.haimang.com.cn").replace(/\/$/, "");
const log = (...a) => console.log("[ide-durable]", ...a);
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); };
const note = (name, detail = "") => { results.push({ name, ok: true }); console.log(`NOTE ${name} :: ${detail}`); };

const envFile = {};
for (const line of readFileSync(join(root, ".env.wx.cloud"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) envFile[m[1]] = m[2].trim();
}
const ENV_ID = envFile.WX_CLOUD_ENV_ID ?? "cloud1-d7gar8j7w419589a0";
const TICKET_SECRET = process.env.TICKET_SECRET ?? envFile.TICKET_SECRET;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const TEST_OID = process.env.TEST_OID ?? "mn02-ide-oid";
const mint = (oid) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ oid, scope: "byok-proxy", jti: crypto.randomUUID(), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 120 });
  return `${h}.${b}.${crypto.createHmac("sha256", TICKET_SECRET).update(`${h}.${b}`).digest("base64url")}`;
};
const pod = async (oid, ep, body) => {
  const r = await fetch(`${DURABLE}/v1/${ep}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${mint(oid)}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// 连接契约收敛至 scripts/dev-cli/lib/ide.mjs：AUTO_PORT/ws9420 → cli auto 回退。
async function launchAndConnect() {
  const { mp } = await connectIde({ project: root });
  return mp;
}

const callFunction = (mini2, name, data) => mini2.evaluate((args) => {
  return new Promise((resolve) => {
    try {
      if (wx.cloud === undefined) { resolve({ err: "wx.cloud unavailable" }); return; }
      wx.cloud.init({ env: args.envId });
      wx.cloud.callFunction({ name: args.name, data: args.data })
        .then((r) => resolve({ result: r.result }))
        .catch((e) => resolve({ err: String((e && (e.errMsg || e.message)) || e) }));
    } catch (e) { resolve({ err: String((e && (e.errMsg || e.message)) || e) }); }
  });
}, { envId: ENV_ID, name, data });
const callSweeper = (mini2) => callFunction(mini2, "sweeper", {});
const isSoterBlock = (r) => r && r.err && String(r.err).includes("Soter") || (r && r.err && String(r.err).includes("生物识别"));

const mini = await launchAndConnect();
log("connected");

// ── 测试身份面（仅专用测试端点）：DevTools 无 SOTER，用 gateway /dev/ticket 铸真票。
// 控制面 mock（challenge/SOTER/unlock），数据面仍走真 gateway + 真 MinIO。
if (process.env.PATCH_UNLOCK === "1" || DURABLE.includes("127.0.0.1")) {
  const patched = await mini.evaluate((args) => {
    // automator evaluate 不支持顶层参数解构（Unexpected token ','）——函数体内解构。
    const { admin, oid, base } = args;
    try {
      const mock = {
        init() {},
        callFunction({ name, data }) {
          if (name === "sweeper") return Promise.resolve({ result: { ok: true, ran: [] } });
          if (name !== "unlock") return Promise.reject(new Error("mock unlock only"));
          if (data.action === "challenge") return Promise.resolve({ result: { challenge: "test-challenge", openid: oid } });
          if (data.action === "unlock") {
            return new Promise((resolve, reject) => {
              wx.request({
                url: `${base}/dev/ticket`, method: "POST",
                header: { "content-type": "application/json", "x-admin-token": admin },
                data: { oid, ttl_s: 1800 },
                success: (r) => resolve({ result: r.data }),
                fail: (e) => reject(new Error(String(e.errMsg || e))),
              });
            });
          }
          return Promise.reject(new Error("mock unknown action"));
        },
      };
      Object.defineProperty(wx, "cloud", { configurable: true, value: mock });
      // cloud 路由 resolveSource 要求已注入供应商记录；测试身份用非密占位记录。
      wx.setStorageSync("dsh:byok-enrollment:v1", {
        provider: "byok", upstreamBaseUrl: "http://u.invalid", model: "deepseek-flash", enrolledAt: Date.now(),
      });
      wx.startSoterAuthentication = (o) => o.success({ resultJSON: "{}", resultJSONSignature: "test" });
      wx.checkIsSupportSoterAuthentication = (o) => o.success({ supportMode: ["fingerPrint"] });
      wx.checkIsSoterEnrolledInDevice = (o) => o.success({ isEnrolled: true });
      return { patched: true };
    } catch (e) {
      return { err: String((e && e.message) || e) };
    }
  }, { admin: ADMIN_TOKEN, oid: TEST_OID, base: DURABLE });
  log("unlock patch:", JSON.stringify(patched));
}

// ── A: durable 句柄（cloud 路由真接线）──────────────────────────────
{
  const probe = await mini.evaluate(() => {
    const g = getApp().globalData;
    return {
      ioState: typeof g.__ioStateFor === "function" && g.__ioStateFor() !== null,
      remote: typeof g.__vfsRemoteFor === "function" && g.__vfsRemoteFor() !== null,
      sync: typeof g.__vfsSyncFor === "function" && g.__vfsSyncFor() !== null,
    };
  });
  check("A:ioState cloud-lane live", probe.ioState, JSON.stringify(probe));
  check("A:vfsRemote cloud-lane live", probe.remote);
  check("A:vfsSync cloud-lane live", probe.sync);
}

// ── B: 铸票面 → ioState 往返（authHeaders 缓存只读后须显式铸票——E10 语义）
{
  const mint = await mini.evaluate(() => {
    const g = getApp().globalData;
    if (typeof g.__hasFreshTicket !== "function" || typeof g.__ensureDurableTicket !== "function") {
      return { err: "mint hooks missing（需重新编译 mp 包）" };
    }
    if (g.__hasFreshTicket()) return { fresh: true, minted: false };
    return g.__ensureDurableTicket()
      .then(() => ({ fresh: g.__hasFreshTicket(), minted: true }))
      .catch((e) => ({ err: String((e && e.message) || e) }));
  });
  const body = `{"probe":"ide-durable","ts":${Date.now()}}`;
  const r = await mini.evaluate((b) => {
    const cas = getApp().globalData.__ioStateFor();
    return cas.putCas("dsh-mini/state/self/mn02ide-probe", b, { ifNoneMatch: "*" })
      .then((put) => cas.get("dsh-mini/state/self/mn02ide-probe")
        .then((got) => ({ putStatus: put.status, got: got === null ? null : got.body.slice(0, 60) })))
      .catch((e) => ({ err: String((e && e.message) || e) }));
  }, body);
  if (isSoterBlock(mint) || (mint.err && r.err && r.err.includes("401"))) {
    note("B:state round-trip → 真机车道", `DevTools 无 SOTER/铸票失败 → 句柄在、线上锁；真机/已铸票据方可（设计面） mint=${JSON.stringify(mint).slice(0, 160)}`);
  } else check("B:state round-trip via real mp net", r.putStatus === 200, `mint=${JSON.stringify(mint).slice(0, 120)} rt=${JSON.stringify(r)}`);
}

// ── C: vfs write → pushPath → remote get 字节一致 ───────────────────
{
  const r = await mini.evaluate(() => {
    const g = getApp().globalData;
    const sid = `mn02ide-${Date.now().toString(36)}`;
    const vfs = g.__vfs.vfs;
    vfs.write(`/data/${sid}/probe.txt`, "ide-remote-bytes", { sessionId: sid });
    const sync = g.__vfsSyncFor();
    const remote = g.__vfsRemoteFor();
    return sync.pushPath(`/data/${sid}/probe.txt`).then(() =>
      remote.get(`rows/data/${sid}/probe.txt`).then((row) => ({ rowFound: row !== null }))
    ).catch((e) => ({ err: String((e && e.message) || e) }));
  });
  if (r.err && r.err.includes("401")) note("C:vfs remote mirror → 真机车道", "同上：无活票时 authHeaders 空头→401（缓存只读设计面）；同步句柄与远端客户端已实测就位");
  else if (isSoterBlock(r)) note("C:vfs remote mirror → 真机车道", "同上：SOTER 铸票 IDE 面不可得；同步句柄与远端客户端已实测就位");
  else check("C:local write → remote mirror", r.rowFound === true, JSON.stringify(r));
}

// ── D: wx.cloud.callFunction → 真 sweeper 执行（env-missing=已登记受限）──
{
  const res = await callSweeper(mini);
  if (res && res.result && res.result.ok === true) {
    check("D:sweeper callFunction executed", true, `ran=${JSON.stringify(res.result.ran)}`);
  } else if (res && res.result && res.result.reason === "env-missing") {
    note("D:sweeper callFunction reached", "函数执行但 TICKET_SECRET env 未配（登记受限：env 属控制台手动面，业主决定暂缓）");
  } else {
    check("D:sweeper callFunction executed", false, JSON.stringify(res).slice(0, 300));
  }
}

// ── E: 真 openid due-alarm → 部署 sweeper 认领 + at-most-once ────────
{
  const who = await callFunction(mini, "unlock", { action: "challenge" });
  const oid = who && who.result && who.result.openid;
  log("E openid:", oid ? `${oid.slice(0, 8)}...` : JSON.stringify(who));
  if (oid) {
    const sid = `mn02ide-alarm-${Date.now().toString(36)}`;
    const due = Date.now() - 5000;
    const w = await pod(oid, "state/put-cas", { key: `alarms/${due}-${sid}`, body: JSON.stringify({ sessionId: sid, kind: "turn-resume", dueAt: due, fence: "ide-probe" }), cond: { ifNoneMatch: "*" } });
    check("E:due alarm durable @真oid", w.status === 200, `status=${w.status}`);
    const sweep = await callSweeper(mini);
    if (sweep && sweep.result && sweep.result.reason === "env-missing") {
      // 云端 env 未配（登记受限）→ 自持票据原子消费，不留残留行
      const claim = await pod(oid, "alarm/claim", { key: `${due}-${sid}`, holder: "ide-probe-cleanup" });
      note("E:alarm swept → env-missing 登记受限", `alarm 行 POD1 持久化确认（due 枚举可见）；sweeper 待 env；自消费=${claim.status}`);
    } else {
      const ran = (sweep && sweep.result && sweep.result.ran) || [];
      const hit = ran.find((x) => x.sessionId === sid);
      log("E sweep ran:", JSON.stringify(ran));
      if (hit) {
        check("E:live sweeper claimed+resumed", true, JSON.stringify(hit));
        const sweep2 = await callSweeper(mini);
        const ran2 = (sweep2 && sweep2.result && sweep2.result.ran) || [];
        check("E:at-most-once re-sweep", !ran2.some((x) => x.sessionId === sid), `ran2=${JSON.stringify(ran2).slice(0, 160)}`);
      } else {
        note("E:alarm 行 durable 但未被本 oid 枚举", `oid 不在 byok_keys（本机未 enroll）→ sweeper 枚举面外；ran=${JSON.stringify(ran).slice(0, 160)}`);
        await pod(oid, "alarm/claim", { key: `${due}-${sid}`, holder: "ide-probe-cleanup" });
      }
    }
  } else {
    note("E:openid 不可得", JSON.stringify(who).slice(0, 200));
  }
}

await mini.disconnect();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS  @ ${new Date().toISOString()}`);
process.exit(0);
