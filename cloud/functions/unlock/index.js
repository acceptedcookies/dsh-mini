// 控制面 unlock：SOTER 验签 → 签发短 TTL 能力票据（byok-proxy 数据面通行）。
// event {action:'challenge'} → 下发一次性 challenge（存 byok_challenges，TTL 2min）
// event {action:'unlock', challenge, result_json, result_signature} → 验签+核新鲜度 → ticket
// 票据规格同步自 cloud/lib/ticket.cjs（HS256 JWT 形状）。
const cloud = require("wx-server-sdk");
const crypto = require("node:crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const CHALLENGE_TTL_MS = 120000;
const TICKET_TTL_S = 1800;
const SCOPE = "byok-proxy";

function signTicket(secret, claims) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const secret = process.env.TICKET_SECRET;
  if (!secret) return { error: "TICKET_SECRET env not configured" };
  const db = cloud.database();
  const col = db.collection("byok_challenges");

  if (event.action === "challenge") {
    const challenge = crypto.randomBytes(16).toString("base64url");
    await col.add({ data: { openid: OPENID, challenge, exp: Date.now() + CHALLENGE_TTL_MS, used: false } });
    return { openid: OPENID, challenge, expires_in_ms: CHALLENGE_TTL_MS };
  }

  if (event.action === "unlock") {
    const { challenge, result_json, result_signature } = event;
    const found = await col.where({ openid: OPENID, challenge, used: false }).get();
    const rec = found.data[0];
    if (!rec || rec.exp < Date.now()) return { error: "challenge invalid/expired/used" };
    const v = await cloud.openapi.soter.verifySignature({
      openid: OPENID,
      jsonString: result_json,
      jsonSignature: result_signature,
    });
    if (v.isOk !== true && v.is_ok !== true) return { error: "soter verify failed", detail: v.errMsg ?? v.errmsg };
    // result_json.raw 必须等于本次 challenge —— 防跨会话重放
    let raw;
    try {
      raw = JSON.parse(result_json).raw;
    } catch {
      return { error: "result_json malformed" };
    }
    if (raw !== challenge) return { error: "challenge mismatch" };
    await col.doc(rec._id).update({ data: { used: true } });
    const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_S;
    const ticket = signTicket(secret, {
      oid: OPENID,
      scope: SCOPE,
      jti: crypto.randomBytes(8).toString("base64url"),
      iat: Math.floor(Date.now() / 1000),
      exp,
    });
    return { ticket, exp };
  }

  return { error: "unknown action" };
};
