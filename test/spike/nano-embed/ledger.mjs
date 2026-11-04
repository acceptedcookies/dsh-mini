// nano-embed spike 行注册表
export default [
  { row: 'em-h1', tier: 'T1', desc: 'kernel 全量 bundle（esbuild alias→TS 源, cjs, minify）', verdict: 'PASS', bytes: 1705046, files: 344, note: 'min 1.63MB; crypto.subtle×2/atob×4 可 polyfill; zod JIT 需 jitless banner' },
  { row: 'em-h2', tier: 'T2', desc: 'T1 + agent-provider-executor', verdict: 'PASS', bytes: 1746791, files: 357, note: '+42KB; fetch=0（I/O 注入式）' },
  { row: 'em-h3', tier: 'T3', desc: 'T2 + agent-core host {kernel,llm} 便携子集', verdict: 'PASS', bytes: 1882116, files: 472, note: 'fetch×2/AbortController×5/env×2；storage-topology 入链' },
  { row: 'em-h4', tier: 'T4', desc: 'workers/agent-core 全量闭包', verdict: 'MEASURED', bytes: 3031199, files: 868, note: '超 2MB/包线；cloudflare:workers external + env×19/fetch×22/Response×32/Request×13/WebSocketPair' },
  { row: 'em-s1', tier: 'S1', desc: 'T1 bundle 在 DevTools appService 实测执行', verdict: 'PASS', note: 'jitless banner 后 loaded=true, 44 exports, canonicalJson/KERNEL_VERSION 正确' },
  { row: 'em-s2', tier: 'S2', desc: '分包摆法计算', verdict: 'DONE', note: '见 README §6.3' },
  { row: 'em-n1', tier: 'N1', desc: 'kernel 决策环 + 每步 fragment CAS 落盘', verdict: 'PASS', note: 'llm_call>tool_exec>llm_call>finish:turn_complete' },
  { row: 'em-n2', tier: 'N2', desc: 'kill/resume durable cursor', verdict: 'PASS', note: 'fragment 恢复后续跑，toolExecs=1 无双跑' },
  { row: 'em-n3', tier: 'N3', desc: 'claim 单写者 + CAS fencing', verdict: 'PASS', note: 'If-None-Match 200/412；stale etag 412' },
  { row: 'em-n4', tier: 'N4', desc: 'alarm 记录 → sweeper tick → resume', verdict: 'PASS', note: 'kill→swept→completed，cron 语义模拟' },
  { row: 'em-r1', tier: 'R1', desc: '真机执行', verdict: 'NOT_RUN', note: '无设备通道' },
]
