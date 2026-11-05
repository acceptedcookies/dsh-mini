// MN02-B5 G4 实验：image llm 双形态实测。
// A) wire-shape：真 io/llm.ts normalizeMessages 把 kernel {kind:'image_url'} 映成 OpenAI
//    image_url 块（images 先 text 后）；真 images.ts resolveImageParts 本地车道出 data:、
//    cloud 车道出 publish→https:（esbuild alias 换依赖，源码不动）。
// B) live 双形态：真 PNG → (1) POD1 artifacts publish → https://…/a/{sha}.png 公网 URL
//    (2) data:image/png;base64 内联 → magpie workbuddy/deepseek-v4.1-flash 视觉应答。
// 证据级：wire=source 级；live=pod1-live-public + 真 llm。
// 用法：TICKET=$(dev-ticket) node test/mn02/vision-dual.mjs
import '../mn01/wx-shim.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import zlib from 'node:zlib'

const BASE = (process.env.BASE ?? 'https://dsh-mini.haimang.com.cn').replace(/\/$/, '')
const TICKET = process.env.TICKET ?? ''
const MAGPIE = (process.env.MAGPIE ?? 'http://127.0.0.1:3425').replace(/\/$/, '')
const MODEL = process.env.MODEL ?? 'workbuddy/deepseek-v4.1-flash'
if (!TICKET) { console.error('TICKET env required'); process.exit(2) }

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const esp = createRequire(join(repo, 'test/spike/package.json'))
const esbuild = esp('esbuild')
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

// ---------- 红/蓝纯色 PNG ----------
function crc32(buf) {
  let c, table = crc32.table
  if (!table) { table = crc32.table = new Int32Array(256); for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c } }
  c = -1; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function solidPng(w, h, r, g, b) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3)])
  const raw = Buffer.alloc(h * (1 + w * 3))
  for (let y = 0; y < h; y++) { row.copy(raw, y * (1 + w * 3)); for (let x = 0; x < w; x++) { const o = y * (1 + w * 3) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}
const RED = solidPng(96, 96, 220, 30, 30)

// ---------- esbuild 打包真 TS（plugins 供依赖面替换）----------
const bundle = async (entry, plugins = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'mn02v-'))
  const ent = join(dir, 'entry.ts')
  writeFileSync(ent, entry)
  const out = await esbuild.build({
    entryPoints: [ent], bundle: true, format: 'cjs', write: false, platform: 'node', target: 'node18', logLevel: 'silent',
    plugins,
  })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, createRequire(join(repo, 'package.json')))
  return mod.exports
}
// local 车道 stub：io/llm 走 upstream 直连（dev-config 实文件在仓内会被真打进 bundle）。
const devStubDir = (() => { const d = mkdtempSync(join(tmpdir(), 'devstub-')); writeFileSync(join(d, 'dev.ts'), `
export const currentRoute = () => ({ mode: 'local' })
export const loadDevConfig = () => ({ providerName: 'magpie', upstreamBaseUrl: 'http://127.0.0.1:3425', providerApiKey: '', model: 'workbuddy/deepseek-v4.1-flash', allowedModels: [], sim: { baseUrl: '' }, cloud: { envId: '', proxyUrl: '' } })
`); return d })()
const devSwap = {
  name: 'dev-swap',
  setup(b) { b.onResolve({ filter: /fx\/dev$/ }, () => ({ path: join(devStubDir, 'dev.ts') })) },
}

// ── A1: normalizeMessages wire-shape（request 间谍）─────────────────
{
  const { createIoLlm } = await bundle(`import { createIoLlm } from '${repo}/services/nano-mini-host/io/llm'; export { createIoLlm }`, [devSwap])
  let wire = null
  const llm = createIoLlm({ request: async (_u, _h, data) => { wire = data; return { status: 200, body: { choices: [{ message: { content: 'ok' } }] } } } })
  // local 路由（无 dev-config → local）→ 无票据需求，message 形状是关注点
  await llm([{ role: 'user', content: [
    { kind: 'image_url', url: 'https://dsh-mini.haimang.com.cn/a/deadbeef.png' },
    { kind: 'image_url', url: 'data:image/png;base64,QUJD' },
    { kind: 'text', text: 'describe' },
  ] }])
  const content = wire?.messages?.[0]?.content
  check('A1:image_url → OpenAI 块×2+text', Array.isArray(content) && content.length === 3
    && content[0].type === 'image_url' && content[0].image_url.url.startsWith('https://')
    && content[1].type === 'image_url' && content[1].image_url.url.startsWith('data:')
    && content[2].type === 'text' && content[2].text === 'describe', JSON.stringify(content).slice(0, 200))
  // 无图消息仍走字符串形态（不回归）
  wire = null
  await llm([{ role: 'user', content: [{ kind: 'text', text: 'plain' }] }])
  check('A1:text-only → string content（不回归）', wire.messages[0].content === 'plain', `content=${JSON.stringify(wire.messages[0].content)}`)
}

// ── A2: resolveImageParts 双车道（alias 换 dev/provider 依赖）────────
{
  const localMod = await bundle(`import { resolveImageParts } from '${repo}/services/nano-mini-host/images'; export { resolveImageParts }`, [devSwap])
  const pngPath = join(mkdtempSync(join(tmpdir(), 'mn02img-')), 'red.png')
  writeFileSync(pngPath, RED)
  const parts = await localMod.resolveImageParts([{ id: 'i1', url: pngPath }])
  check('A2:local lane → data: part', parts.length === 1 && parts[0].kind === 'image_url' && parts[0].url.startsWith('data:image/png;base64,'), parts[0]?.url.slice(0, 60))
}

// A2b: cloud lane——onResolve 换 dev/provider 依赖（源码不动，换的是注入面）
{
  const d1 = mkdtempSync(join(tmpdir(), 'ad-')); const d2 = mkdtempSync(join(tmpdir(), 'ap-'))
  writeFileSync(join(d1, 'dev.ts'), `export const currentRoute = () => ({ mode: 'cloud' })`)
  writeFileSync(join(d2, 'provider.ts'), `export const vfsRemoteFor = () => globalThis.__fakeRemote`)
  globalThis.__fakeRemote = { publishArtifact: async (bytes, mime) => ({ sha256: 'ab'.repeat(32), url: 'https://dsh-mini.haimang.com.cn/a/' + 'ab'.repeat(32) + '.png', objectKey: 'x' }) }
  const entDir = mkdtempSync(join(tmpdir(), 'en-')); const ent = join(entDir, 'e.ts')
  writeFileSync(ent, `import { resolveImageParts } from '${repo}/services/nano-mini-host/images'; export { resolveImageParts }`)
  const out = await esbuild.build({
    entryPoints: [ent], bundle: true, format: 'cjs', write: false, platform: 'node', target: 'node18', logLevel: 'silent',
    plugins: [{
      name: 'dep-swap',
      setup(b) {
        b.onResolve({ filter: /\.\.\/(fx\/dev|state\/provider)$/ }, (a) =>
          a.path.endsWith('fx/dev') ? { path: join(d1, 'dev.ts') } : { path: join(d2, 'provider.ts') })
      },
    }],
  })
  const m = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, createRequire(join(repo, 'package.json')))
  const { resolveImageParts } = m.exports
  const pngPath = join(mkdtempSync(join(tmpdir(), 'mn02img-')), 'red.png')
  writeFileSync(pngPath, RED)
  const parts = await resolveImageParts([{ id: 'i1', url: pngPath }])
  check('A2:cloud lane → publish https: part', parts.length === 1 && parts[0].url === `https://dsh-mini.haimang.com.cn/a/${'ab'.repeat(32)}.png`, parts[0]?.url)
}

// ── B: live 双形态 vs magpie 真视觉模型 ──────────────────────────────
const chat = async (url) => {
  const r = await fetch(`${MAGPIE}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, stream: false, messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url } },
      { type: 'text', text: 'What single color fills this square? Answer with one word.' },
    ] }] }),
  })
  const b = await r.json().catch(() => null)
  return { status: r.status, text: b?.choices?.[0]?.message?.content ?? null, raw: b }
}

{
  // B1: publish → https:（公网 artifact 出口 → 模型拉取）
  const pub = await fetch(`${BASE}/v1/artifacts/publish`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TICKET}` },
    body: JSON.stringify({ bytes_b64: RED.toString('base64'), mime: 'image/png' }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
  check('B1:artifact publish', pub.status === 200 && typeof pub.body?.url === 'string', `status=${pub.status} url=${pub.body?.url}`)
  if (pub.status === 200) {
    const v = await chat(pub.body.url)
    check('B1:https: vision 应答', v.status === 200 && typeof v.text === 'string' && /red/i.test(v.text), `status=${v.status} reply=${JSON.stringify(v.text ?? v.raw)?.slice(0, 160)}`)
  }
  // B2: data: 内联同图
  const v2 = await chat(`data:image/png;base64,${RED.toString('base64')}`)
  check('B2:data: vision 应答', v2.status === 200 && typeof v2.text === 'string' && /red/i.test(v2.text), `status=${v2.status} reply=${JSON.stringify(v2.text ?? v2.raw)?.slice(0, 160)}`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS  @ ${new Date().toISOString()}`)
process.exit(failed.length === 0 ? 0 : 1)
