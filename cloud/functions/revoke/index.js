// 控制面 revoke：吊销票据 jti + 删除该 openid 的密钥记录。
// event {action:'ticket', ticket} → 黑名单 jti
// event {action:'key', provider} → 删记录（openid 取 wxContext，用户只能删自己的）
const cloud = require("wx-server-sdk");
const crypto = require("node:crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function verifyTicket(secret, token, scope) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expect = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  if (expect.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(parts[2]))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.exp === undefined || Date.now() / 1000 >= payload.exp) return null;
  if (scope !== undefined && payload.scope !== scope) return null;
  return payload;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const db = cloud.database();
  if (event.action === "ticket") {
    const payload = verifyTicket(process.env.TICKET_SECRET, event.ticket, "byok-proxy");
    if (!payload || payload.oid !== OPENID) return { error: "invalid ticket" };
    await db.collection("byok_revoked").add({ data: { jti: payload.jti, openid: OPENID, exp: payload.exp, revoked_at: Date.now() } });
    return { ok: true };
  }
  if (event.action === "key") {
    await db.collection("byok_keys").where({ openid: OPENID, provider: event.provider }).remove();
    return { ok: true };
  }
  return { error: "unknown action" };
};
