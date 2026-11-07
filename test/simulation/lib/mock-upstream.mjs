// 外部提供方边界：只替换 LLM 上游。App、VFS、durable 客户端不经过这里。
import { createServer } from 'node:http'
import { SCRIPT } from './fixtures.mjs'

function sse(text) {
  const chunk = JSON.stringify({ choices: [{ delta: { content: text } }] })
  const done = JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })
  return `data: ${chunk}\n\ndata: ${done}\n\ndata: [DONE]\n\n`
}

export function startScriptedLlm(script = SCRIPT) {
  const seen = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    let body = {}
    try { body = raw ? JSON.parse(raw) : {} } catch { body = { raw } }
    seen.push({ path: req.url, model: body.model ?? null })
    if (script.fail === true) {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: script.error }))
      return
    }
    const tool = script.tool === true
    const payload = tool
      ? { choices: [{ message: { tool_calls: [{ id: 'sim-call', function: { name: script.toolName, arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }
      : null
    if (String(req.headers.accept ?? '').includes('text/event-stream') || body.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(sse(script.text))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload ?? { choices: [{ message: { content: script.text }, finish_reason: 'stop' }] }))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        base: `http://127.0.0.1:${port}/v1`,
        seen: () => seen.slice(),
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}
