// 信封加密 canonical 实现 —— 控制面(enroll)/数据面(proxy)/sim 三方共用。
// 结构: DEK = HKDF-SHA256(MASTER_KEY, recordId); ciphertext = AES-256-GCM(DEK, plaintext, AAD)
// AAD 绑定 openid|provider|recordId —— 防止密文跨记录/跨用户移植。
// 部署注意: functions/proxy 目录各自携带本文件的同步副本（见 cloud/README.md）。
const crypto = require("node:crypto");

const AAD_SEP = "|";

function dek(masterKey, recordId) {
  return crypto.hkdfSync("sha256", Buffer.from(masterKey, "utf8"), Buffer.from(recordId, "utf8"), Buffer.from("dsh-byok-dek", "utf8"), 32);
}

function aad(openid, provider, recordId) {
  return [openid, provider, recordId].join(AAD_SEP);
}

/** plaintext: string → { iv, tag, data } base64url */
function encryptKey(masterKey, recordId, openid, provider, plaintext) {
  const key = Buffer.from(dek(masterKey, recordId));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad(openid, provider, recordId), "utf8"));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("base64url"), tag: tag.toString("base64url"), data: data.toString("base64url") };
}

function decryptKey(masterKey, record, recordId, openid, provider) {
  const key = Buffer.from(dek(masterKey, recordId));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64url"));
  decipher.setAAD(Buffer.from(aad(openid, provider, recordId), "utf8"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(record.data, "base64url")), decipher.final()]).toString("utf8");
}

module.exports = { encryptKey, decryptKey };
