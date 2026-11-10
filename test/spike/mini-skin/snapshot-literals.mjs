#!/usr/bin/env node
/**
 * MS02 P0 字面量台账。已存在则拒绝覆写（无 --force）。
 * 记录的是改写 .less 之前的声明，供零行为对照，不参与产品构建。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listComponentDirs, scanComponent } from './classify-literals.mjs'

const ROOT = new URL('../../../', import.meta.url).pathname
const LEDGER = join(ROOT, 'test/spike/mini-skin/component-literal-ledger.json')

if (existsSync(LEDGER)) {
  console.error(`FATAL: 台账已存在，拒绝覆写: ${LEDGER}`)
  process.exit(1)
}

const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const declarations = []
for (const name of listComponentDirs(ROOT)) {
  const { decls } = scanComponent(ROOT, name)
  for (const d of decls) {
    declarations.push({
      file: d.file,
      line: d.line,
      selector: d.selector,
      prop: d.prop,
      value: d.value,
      inMedia: d.inMedia,
      inKeyframes: d.inKeyframes,
    })
  }
}

const ledger = {
  tool: 'snapshot-literals.mjs',
  headSha,
  generatedAt: new Date().toISOString(),
  componentCount: listComponentDirs(ROOT).length,
  declarationCount: declarations.length,
  declarations,
}
writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n')
console.log(JSON.stringify({ ok: true, headSha, declarationCount: declarations.length, file: 'test/spike/mini-skin/component-literal-ledger.json' }))
