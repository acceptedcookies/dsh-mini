#!/usr/bin/env node
// spike / nano-tools — H1 driver: Node + tmp-dir workspace adapter.
// Loads bundle/spike-runtime.cjs, seeds fixtures, runs rows/rows.json,
// writes evidence/h1-<ts>.json + console verdict table.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
// H1 exercises the REAL content-scan wasm kernel; mp lanes use the TS sim.
const WASM = path.resolve(HERE, '../../../context/nano-agent/packages/content-scan-kernel/artifacts/content-scan-kernel.wasm')
const NM = path.resolve(HERE, '../node_modules')
const TS_WASM = {
  runtime: path.join(NM, 'web-tree-sitter/tree-sitter.wasm'),
  js: path.join(NM, 'tree-sitter-javascript/tree-sitter-javascript.wasm'),
  py: path.join(NM, 'tree-sitter-python/tree-sitter-python.wasm'),
}
const BUNDLE = process.env.SPIKE_BUNDLE ? path.resolve(process.env.SPIKE_BUNDLE) : path.join(HERE, 'bundle/spike-runtime.cjs')
const spike = require(BUNDLE)
const { createSpikeRuntime } = spike
const { createNodeWorkspace, seed } = await import(path.join(HERE, 'src/adapter-node.mjs'))

const ROWS = JSON.parse(fs.readFileSync(path.join(HERE, 'rows/rows.json'), 'utf8'))

function extractText(res) {
  if (!res || !res.result) return JSON.stringify(res ?? null)
  const r = res.result
  if (r.kind === 'inline-text') return r.text ?? ''
  if (r.kind === 'inline-bytes') { try { return Buffer.from(r.bytes_base64 ?? '', 'base64').toString('utf8') } catch { return '' } }
  if (r.kind === 'partial') return r.content?.text ?? (r.content?.bytes_base64 ? Buffer.from(r.content.bytes_base64, 'base64').toString('utf8') : '')
  if (r.kind === 'rejected' || r.kind === 'error') return `${r.error?.code ?? ''}: ${r.error?.message ?? ''}`
  return JSON.stringify(r)
}
const KIND_MAP = { 'inline-text': 'ok', 'inline-bytes': 'ok', 'partial': 'ok', 'rejected': 'rejected', 'error': 'error' }

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nano-tools-h1-'))
  const ws = createNodeWorkspace(tmp)

  // seed fixtures
  const files = { ...ROWS.fixtures }
  delete files['/data/spike/big.txt']
  await seed(ws, files)
  await ws.writeFile('/data/spike/big.txt',
    Array.from({ length: ROWS.big_lines }, (_, i) => `line-${i + 1}`).join('\n') + '\n')

  // H1 runs rg against the REAL content-scan wasm artifact; mp lanes run the
  // TS simulation of the same ABI. Row-for-row agreement is the fidelity proof.
  if (process.env.SPIKE_KERNEL !== 'ts' && typeof spike.useWasmKernel === 'function' && fs.existsSync(WASM)) {
    spike.useWasmKernel(new Uint8Array(fs.readFileSync(WASM)))
    console.log('[h1] content-scan kernel: real wasm (' + (fs.statSync(WASM).size / 1024 | 0) + ' KB)')
  } else {
    console.log('[h1] content-scan kernel: TS sim (wasm artifact not found)')
  }

  if (typeof spike.useSpanWasm === 'function' && Object.values(TS_WASM).every((p) => fs.existsSync(p))) {
    spike.useSpanWasm(new Uint8Array(fs.readFileSync(TS_WASM.runtime)), new Uint8Array(fs.readFileSync(TS_WASM.js)), new Uint8Array(fs.readFileSync(TS_WASM.py)))
    console.log('[h1] span parser: real web-tree-sitter + js/py grammars')
  } else {
    console.log('[h1] span parser: unconfigured (grammar wasm missing)')
  }

  const rt = createSpikeRuntime(ws, { workspacePath: '/data/spike' })
  const evidence = {
    env: 'H1', at: new Date().toISOString(),
    ids: rt.ids.length, rows: [],
    summary: { pass: 0, degraded: 0, unavailable: 0, 'rejected-honest': 0, fake: 0, plants_ok: 0, plants_red: 0 },
  }

  for (const row of ROWS.rows) {
    const toolName = row.tool ?? row.id
    let raw, err
    try {
      raw = row.mode === 'bash'
        ? await rt.dispatchBash(row.line)
        : await rt.dispatchTool(toolName, row.args)
    } catch (e) { err = e }

    const rKind = raw?.result?.kind ?? null
    const text = extractText(raw)
    const actualKind = err ? 'threw' : (KIND_MAP[rKind] ?? 'unknown')
    const code = raw?.result?.error?.code ?? null

    // verify block: direct adapter read after execution
    let verify = null, verifyOk = null
    if (row.verify?.read) {
      const st = await ws.classifyWorkspacePath(row.verify.read)
      const content = st.kind === 'file' ? await ws.readFile(row.verify.read) : null
      verify = { kind: st.kind, content: content?.slice(0, 200) ?? null }
      verifyOk = row.verify.missing ? st.kind === 'missing'
        : row.verify.isDir ? st.kind === 'directory'
        : row.verify.contains ? (content ?? '').includes(row.verify.contains)
        : st.kind === 'file'
    }

    // expectation evaluation
    // degraded = executed (kind ok) but semantic mismatch (contains/absent fail)
    // fake     = claimed effect that verify cannot observe (write ok + file absent)
    // unavailable = honest err/rejected when ok was hoped
    let pass, verdict
    const containsOk = (row.expect.contains ?? []).every(s => text.includes(s))
    const absentOk = (row.expect.absent ?? []).every(s => !text.includes(s))
    const expectKind = row.expect.kind
    if (expectKind === 'ok') {
      pass = actualKind === 'ok' && containsOk && absentOk && (verifyOk ?? true) && !err
      verdict = pass ? 'pass'
        : (actualKind === 'ok' && (verifyOk === false) ? 'fake'
        : (actualKind === 'ok' ? 'degraded' : 'unavailable'))
    } else if (expectKind === 'err') {
      pass = (actualKind === 'error' || actualKind === 'rejected' || actualKind === 'threw') && containsOk
      verdict = pass ? 'rejected-honest' : 'fake'
    } else { // any
      pass = true
      verdict = actualKind === 'ok' ? 'pass' : (actualKind === 'rejected' || actualKind === 'error' ? 'unavailable' : 'degraded')
    }
    if (row.plant) {
      // plants: assertion MUST fail for the harness to be valid
      const plantRed = !pass
      if (plantRed) evidence.summary.plants_red++; else evidence.summary.plants_ok++
      verdict = plantRed ? 'plant-red-ok' : 'PLANT-GREEN-BAD'
      pass = plantRed
    } else {
      evidence.summary[verdict] = (evidence.summary[verdict] ?? 0) + 1
    }

    evidence.rows.push({
      id: row.id, mode: row.mode, actualKind, code,
      verdict,
      text: text.slice(0, 400), verify, verifyOk, threw: err ? String(err) : null,
      note: row.expect.note ?? null,
    })
    const mark = row.plant ? (pass ? 'plant✓' : 'PLANT✗') : (verdict === 'pass' ? 'PASS' : verdict === 'fake' ? 'FAKE' : verdict)
    console.log(`${String(mark).padEnd(12)} ${row.id.padEnd(18)} ${actualKind.padEnd(9)} ${code ?? ''} ${text.slice(0, 90).replace(/\n/g, '⏎')}`)
  }

  fs.mkdirSync(path.join(HERE, 'evidence'), { recursive: true })
  const f = path.join(HERE, `evidence/h1-${Date.now()}.json`)
  fs.writeFileSync(f, JSON.stringify(evidence, null, 2))
  console.log(`\n[h1] ${JSON.stringify(evidence.summary)}`)
  console.log(`[h1] evidence -> ${path.relative(process.cwd(), f)}`)
}
main().catch(e => { console.error(e); process.exit(1) })
