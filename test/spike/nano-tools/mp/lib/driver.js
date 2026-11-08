// spike / nano-tools — mp-side matrix driver (mirrors run-h1.mjs verdict logic).
// Runs rows sequentially inside mp JSCore; emits console lines + returns evidence.
// NOTE: no ?? / ?. here — DevTools device compile parses with a pre-es2020
// parser (es6:false), so mp-side files stay es2017-safe.
const { resetLanes } = require('./wx-workspace.js')
const { ROWS } = require('./rows.js')

const KIND_MAP = { 'inline-text': 'ok', 'inline-bytes': 'ok', 'partial': 'ok', 'rejected': 'rejected', 'error': 'error' }
const or = (v, d) => (v === undefined || v === null) ? d : v

function extractText(res) {
  if (!res || !res.result) return JSON.stringify(or(res, null))
  const r = res.result
  if (r.kind === 'inline-text') return or(r.text, '')
  if (r.kind === 'inline-bytes') { try { return dec2str(wx.base64ToArrayBuffer(or(r.bytes_base64, ''))) } catch (e) { return '' } }
  if (r.kind === 'partial') {
    const c = r.content || {}
    return or(c.text, c.bytes_base64 ? dec2str(wx.base64ToArrayBuffer(c.bytes_base64)) : '')
  }
  if (r.kind === 'rejected' || r.kind === 'error') {
    const e = r.error || {}
    return or(e.code, '') + ': ' + or(e.message, '')
  }
  return JSON.stringify(r)
}
const _td = new TextDecoder()
function dec2str(ab) { return _td.decode(ab) }

async function runMatrix(rt, ws, log) {
  log('[nano-tools] STEP resetLanes')
  await resetLanes()
  log('[nano-tools] STEP seed')
  // seed fixtures (same as H1)
  const files = Object.assign({}, ROWS.fixtures)
  delete files['/data/spike/big.txt']
  for (const [vp, c] of Object.entries(files)) await ws.writeFile(vp, c)
  await ws.writeFile('/data/spike/big.txt',
    Array.from({ length: ROWS.big_lines }, (_, i) => `line-${i + 1}`).join('\n') + '\n')
  log('[nano-tools] STEP rows-begin')

  const evidence = {
    env: 'MP', at: new Date().toISOString(),
    ids: rt.ids.length, rows: [],
    summary: { pass: 0, degraded: 0, unavailable: 0, 'rejected-honest': 0, fake: 0, plants_ok: 0, plants_red: 0 },
  }

  for (const row of ROWS.rows) {
    const toolName = or(row.tool, row.id)
    let raw, err
    log('[nano-tools] STEP row ' + row.id)
    try {
      raw = row.mode === 'bash'
        ? await rt.dispatchBash(row.line)
        : await rt.dispatchTool(toolName, row.args)
    } catch (e) { err = e }

    const rKind = (raw && raw.result && raw.result.kind) || null
    const text = extractText(raw)
    const actualKind = err ? 'threw' : or(KIND_MAP[rKind], 'unknown')
    const code = (raw && raw.result && raw.result.error && raw.result.error.code) || null

    let verify = null, verifyOk = null
    if (row.verify && row.verify.read) {
      const st = await ws.classifyWorkspacePath(row.verify.read)
      const content = st.kind === 'file' ? await ws.readFile(row.verify.read) : null
      const c0 = or(content, '')
      verify = { kind: st.kind, content: c0.slice(0, 200) || null }
      verifyOk = row.verify.missing ? st.kind === 'missing'
        : row.verify.isDir ? st.kind === 'directory'
        : row.verify.contains ? c0.includes(row.verify.contains)
        : st.kind === 'file'
    }

    let pass, verdict
    const expect = row.expect || {}
    const containsOk = or(expect.contains, []).every(s => text.includes(s))
    const absentOk = or(expect.absent, []).every(s => !text.includes(s))
    const expectKind = expect.kind
    if (expectKind === 'ok') {
      pass = actualKind === 'ok' && containsOk && absentOk && or(verifyOk, true) && !err
      verdict = pass ? 'pass'
        : (actualKind === 'ok' && (verifyOk === false) ? 'fake'
        : (actualKind === 'ok' ? 'degraded' : 'unavailable'))
    } else if (expectKind === 'err') {
      pass = (actualKind === 'error' || actualKind === 'rejected' || actualKind === 'threw') && containsOk
      verdict = pass ? 'rejected-honest' : 'fake'
    } else {
      pass = true
      verdict = actualKind === 'ok' ? 'pass' : (actualKind === 'rejected' || actualKind === 'error' ? 'unavailable' : 'degraded')
    }
    if (row.plant) {
      const plantRed = !pass
      if (plantRed) evidence.summary.plants_red++; else evidence.summary.plants_ok++
      verdict = plantRed ? 'plant-red-ok' : 'PLANT-GREEN-BAD'
      pass = plantRed
    } else {
      evidence.summary[verdict] = or(evidence.summary[verdict], 0) + 1
    }

    const rec = {
      id: row.id, mode: row.mode, actualKind, code, verdict,
      text: text.slice(0, 300), verifyOk, threw: err ? String(err) : null,
    }
    evidence.rows.push(rec)
    log(`[nano-tools] ROW ${JSON.stringify(rec)}`)
    await new Promise(r => setTimeout(r, 30)) // yield to wx scheduler
  }
  evidence.wsRoot = 'nspike'
  return evidence
}

module.exports = { runMatrix }
