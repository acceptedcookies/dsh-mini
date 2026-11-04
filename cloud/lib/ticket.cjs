// 能力票据 canonical 实现 —— HS256 短 TTL bearer 票据。
// 格式: b64url(header).b64url(payload).b64url(hmac) —— JWT 形状但仅我们签发/校验。
// 部署注意: functions(unlock 签发)/proxy(校验)/sim 共用同步副本。
const crypto = require("node:crypto");

function signTicket(secret, claims) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

/** 返回 payload 或 null（签名错/过期/scope 不符）。 */
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

module.exports = { signTicket, verifyTicket };
