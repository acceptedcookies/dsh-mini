// 控制面 enroll：登记用户 BYOK key —— 信封加密后写 per-openid 记录。
// 业主裁决：无 bio 禁止 apikey 注入 —— 与 unlock 共用 byok_challenges 一次性 challenge，
// 服务端强制 soter.verifySignature（客户端门禁仅为 UX，服务端必须独立把关）。
// event: { provider, base_url, api_key, model, challenge, result_json, result_signature }
// env: MASTER_KEY；ALLOWED_MODELS（逗号分隔，缺省不限）
// 与 canonical 规格同步: cloud/lib/envelope.cjs（本目录自包含，云函数上传只取本目录）。
const cloud = require("wx-server-sdk");
const crypto = require("node:crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const COLLECTION = "byok_keys";
const CHALLENGES = "byok_challenges";

function dek(masterKey, recordId) {
  return crypto.hkdfSync("sha256", Buffer.from(masterKey, "utf8"), Buffer.from(recordId, "utf8"), Buffer.from("dsh-byok-dek", "utf8"), 32);
}

function encryptKey(masterKey, recordId, openid, provider, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(dek(masterKey, recordId)), iv);
  cipher.setAAD(Buffer.from([openid, provider, recordId].join("|"), "utf8"));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: data.toString("base64url") };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const masterKey = process.env.MASTER_KEY;
  if (!masterKey) return { error: "MASTER_KEY env not configured" };
  const { provider, base_url, api_key, model, challenge, result_json, result_signature } = event;
  if (typeof provider !== "string" || !provider || typeof base_url !== "string" || !base_url || typeof api_key !== "string") {
    return { error: "provider/base_url/api_key required" };
  }
  const allowed = (process.env.ALLOWED_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length > 0 && (typeof model !== "string" || !allowed.includes(model))) {
    return { error: `model not allowed: ${model}` };
  }
  const db = cloud.database();
  const col = db.collection(CHALLENGES);
  const found = await col.where({ openid: OPENID, challenge, used: false }).get();
  const rec = found.data[0];
  if (!rec || rec.exp < Date.now()) return { error: "challenge invalid/expired/used" };
  const v = await cloud.openapi.soter.verifySignature({
    openid: OPENID,
    jsonString: result_json,
    jsonSignature: result_signature,
  });
  if (v.isOk !== true && v.is_ok !== true) return { error: "soter verify failed", detail: v.errMsg ?? v.errmsg };
  let raw;
  try {
    raw = JSON.parse(result_json).raw;
  } catch {
    return { error: "result_json malformed" };
  }
  if (raw !== challenge) return { error: "challenge mismatch" };
  await col.doc(rec._id).update({ data: { used: true } });
  const recordId = crypto.randomBytes(8).toString("base64url");
  const ciphertext = encryptKey(masterKey, recordId, OPENID, provider, api_key);
  await db.collection(COLLECTION).where({ openid: OPENID, provider }).remove();
  await db.collection(COLLECTION).add({
    data: { recordId, openid: OPENID, provider, base_url, model: model ?? null, ciphertext, key_version: 1, created_at: Date.now() },
  });
  return { ok: true, provider };
};
