// 全包审计：按 app.json subpackages + project.config.json packOptions.ignore
// 实算主包/各分包体积，2M 单包硬闸 + 30M 总闸。回答"什么应该打包"。
// 用法：node scripts/pack-audit.mjs  （CI/上传前自检；超限 exit 1）
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIMIT_PKG = 2 * 1024 * 1024
const LIMIT_TOTAL = 30 * 1024 * 1024

const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'))
const pc = JSON.parse(readFileSync(join(root, 'project.config.json'), 'utf8'))
const ig = { folder: new Set(), file: new Set() }
for (const e of pc.packOptions?.ignore ?? []) ig[e.type === 'folder' ? 'folder' : 'file'].add(e.value.replace(/\/$/, ''))

const subRoots = (app.subpackages ?? app.subPackages ?? []).map((s) => s.root.replace(/\/$/, ''))
const sizes = new Map(subRoots.map((r) => [r, 0]))
sizes.set('(main)', 0)
const perPkgFiles = new Map([...sizes.keys()].map((k) => [k, []]))

const skipTop = new Set(['.git', ...ig.folder])
function walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const rel = join(dir, ent.name).slice(root.length + 1)
    if (ent.isDirectory()) {
      if (ent.name.startsWith('.') && ig.folder.has(ent.name)) continue
      if (ig.folder.has(rel) || ig.folder.has(ent.name)) continue
      walk(join(dir, ent.name))
      continue
    }
    if (ig.file.has(rel) || ig.file.has(ent.name)) continue
    if (ent.name === '.DS_Store') continue
    const top = rel.split(sep)[0]
    if (skipTop.has(top)) continue
    const pkg = subRoots.find((r) => rel === r || rel.startsWith(r + sep)) ?? '(main)'
    const s = statSync(join(dir, ent.name)).size
    sizes.set(pkg, sizes.get(pkg) + s)
    perPkgFiles.get(pkg).push([s, rel])
  }
}
walk(root)

let fail = false
let total = 0
console.log('== pack-audit（按 packOptions.ignore + app.json subpackages 实算）==')
for (const [pkg, sz] of [...sizes.entries()].sort((a, b) => b[1] - a[1])) {
  total += sz
  const files = perPkgFiles.get(pkg).sort((a, b) => b[0] - a[0])
  const over = sz > LIMIT_PKG
  if (over) fail = true
  console.log(`${over ? 'FAIL' : 'PASS'} ${pkg.padEnd(18)} ${(sz / 1048576).toFixed(2)} MB / 2M  ${files.length} 文件`)
  for (const [s, f] of files.slice(0, 5)) console.log(`       ${(s / 1024).toFixed(0).padStart(6)} KB  ${f}`)
}
console.log(`-- 总计 ${(total / 1048576).toFixed(2)} MB / 30M`)
if (total > LIMIT_TOTAL) fail = true
process.exit(fail ? 1 : 0)
