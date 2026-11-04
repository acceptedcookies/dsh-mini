/**
 * fx-core.wasm 宿主运行时 —— sdk/wasm-runtime.js 的小程序移植。
 * JSPI Suspending → binaryen Asyncify 驱动；宿主能力经 FxEnv 注入。
 */
import type { FxEnv } from './env'

const ASYNCIFY_PAGE_BYTES = 65536

export interface HostToolResult {
  content: string
  isError?: boolean
  rich?: boolean
  cancelled?: boolean
}
export type HostToolExecutor = (name: string, input: unknown, sessionId: string | undefined, callId: string) => Promise<HostToolResult> | HostToolResult

export interface FxRuntimeOptions {
  args?: string[]
  env?: Record<string, string>
  stdout?: (chunk: Uint8Array) => void | Promise<void>
  stderr?: (chunk: Uint8Array) => void
  hostToolExecutor?: HostToolExecutor
  journalFlush?: () => Promise<void>
  onTransportChunk?: (bytes: number) => void
  onStartSettled?: (error: unknown) => void
}

export interface FxRuntime {
  readonly imports: Record<string, Record<string, unknown>>
  readonly exited: Promise<number>
  readonly exitCode: number | null
  readonly aborted: boolean
  readonly error: unknown
  write(data: string | Uint8Array): void
  wake(): void
  closeStdin(): void
  openSteering(): void
  closeSteering(): void
  abort(error?: unknown): void
  setStdoutHandler(fn: ((chunk: Uint8Array) => void | Promise<void>) | undefined): void
  start(wasmPath: string): Promise<FxRuntime>
}

interface ByteQueue {
  chunks: Uint8Array[]
  waiters: Array<() => void>
  closed: boolean
  push(b: Uint8Array): void
  read(max: number): Uint8Array | null
  wait(t?: number): Promise<boolean>
  close(): void
  wake(): void
}

interface StreamState {
  response: { status: number; body: { read(): Promise<{ done: boolean; value?: Uint8Array }> } | null } | null
  reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> } | null
  responseError: unknown
  settled: Promise<void>
  pendingRead: Promise<void> | null
  readResult: { done: boolean; value?: Uint8Array } | null
  readError: unknown
  leftover: Uint8Array
  abort?: () => void
}

export function createFxRuntime(env: FxEnv, options: FxRuntimeOptions): FxRuntime {
  const encoder = new env.TextEncoder()
  const decoder = new env.TextDecoder()
  const stdin: ByteQueue = {
    chunks: [],
    waiters: [],
    closed: false,
    push(b: Uint8Array) {
      if (this.closed) throw new Error('stdin closed')
      if (b.length) {
        this.chunks.push(b)
        this.wake()
      }
    },
    read(max: number) {
      if (!this.chunks.length) return null
      const c = this.chunks[0]
      const v = c.subarray(0, max)
      if (v.length === c.length) this.chunks.shift()
      else this.chunks[0] = c.subarray(v.length)
      return v
    },
    wait(t?: number) {
      if (this.closed) return Promise.resolve(true)
      return new Promise((resolve) => {
        let done = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const w = () => {
          if (done) return
          done = true
          if (timer !== undefined) clearTimeout(timer)
          resolve(true)
        }
        this.waiters.push(w)
        if (t !== undefined) {
          timer = setTimeout(() => {
            if (done) return
            done = true
            const i = this.waiters.indexOf(w)
            if (i >= 0) this.waiters.splice(i, 1)
            resolve(false)
          }, t)
        }
      })
    },
    close() {
      this.closed = true
      this.wake()
    },
    wake() {
      this.waiters.splice(0).forEach((w) => w())
    },
  }

  const streams = new Map<number, StreamState>()
  const steering: Array<{ id: string; value: Uint8Array }> = []
  let steeringOpen = false
  let steeringHandoff = false
  let steeringBytes = 0
  let instance: { exports: Record<string, any> } | null = null
  let exports_: Record<string, any> | null = null
  let dataAddr = -1
  let nextHandle = 1
  let exitedResolve!: (code: number) => void
  const exited = new Promise<number>((r) => {
    exitedResolve = r
  })
  let exitCode: number | null = null
  let aborted = false
  let abortError: unknown = null
  const markExited = (c: number) => {
    if (exitCode === null) {
      exitCode = c
      exitedResolve(c)
    }
  }

  const memory = () => instance!.exports.memory as { buffer: ArrayBuffer; grow(d: number): number }
  const bytes = (ptr: number, len: number) => new Uint8Array(memory().buffer, ptr, len)
  const text = (ptr: number, len: number) => decoder.decode(bytes(ptr, len))
  const writeU32 = (ptr: number, v: number) => new DataView(memory().buffer).setUint32(ptr, v, true)
  const writeU64 = (ptr: number, v: number | bigint) => new DataView(memory().buffer).setBigUint64(ptr, BigInt(v), true)

  // ---- asyncify 驱动 ----
  const S_REWINDING = 2
  let pendingResult: unknown
  let pendingFailure = false
  let running = false
  const astate = (): number => exports_!.asyncify_get_state() as number

  function resume(): void {
    if (!running) return
    exports_!.asyncify_start_rewind(dataAddr)
    try {
      exports_!._start()
    } catch (e) {
      onStartError(e)
    }
  }
  function onStartError(e: unknown): void {
    running = false
    if (String(e).includes('proc_exit')) {
      markExited(exitCode ?? 0)
    } else {
      abortError = e
      abortHostEffects()
      stdin.close()
      markExited(aborted ? 130 : 1)
    }
    options.onStartSettled?.(e)
  }
  type MaybePromise<T> = T | Promise<T>
  function suspending(fn: (...args: number[]) => MaybePromise<number>, dummy = 0): (...args: number[]) => number {
    return (...args: number[]) => {
      if (astate() === S_REWINDING) {
        exports_!.asyncify_stop_rewind()
        if (pendingFailure) {
          pendingFailure = false
          return -1
        }
        const v = pendingResult
        pendingResult = undefined
        return v as number
      }
      const r = fn(...args)
      if (r === null || typeof r !== 'object' || typeof (r as Promise<number>).then !== 'function') return r as number
      ;(r as Promise<number>).then(
        (v) => {
          pendingResult = v
          resume()
        },
        () => {
          pendingFailure = true
          resume()
        },
      )
      exports_!.asyncify_start_unwind(dataAddr)
      return dummy
    }
  }

  // ---- WASI ----
  const args = options.args || []
  const environ = Object.entries(options.env || {}).map(([k, v]) => `${k}=${v}`)
  function writeVector(values: string[], ptrs: number, data: number): void {
    let cursor = data
    values.forEach((v, i) => {
      const enc = encoder.encode(`${v}\0`)
      writeU32(ptrs + i * 4, cursor)
      bytes(cursor, enc.length).set(enc)
      cursor += enc.length
    })
  }

  let stdoutHandler = options.stdout
  function fdWrite(fd: number, iovs: number, count: number, nwritten: number): MaybePromise<number> {
    const view = new DataView(memory().buffer)
    let total = 0
    for (let i = 0; i < count; i++) total += view.getUint32(iovs + i * 8 + 4, true)
    if (fd === 1 || fd === 2) {
      const chunk = new Uint8Array(total)
      let off = 0
      for (let i = 0; i < count; i++) {
        const p = view.getUint32(iovs + i * 8, true)
        const l = view.getUint32(iovs + i * 8 + 4, true)
        chunk.set(bytes(p, l), off)
        off += l
      }
      if (fd === 1) {
        const pending = stdoutHandler?.(chunk)
        if (pending && typeof pending.then === 'function') {
          return (pending as Promise<void>).then(() => {
            writeU32(nwritten, total)
            return 0
          })
        }
      } else options.stderr ? options.stderr(chunk) : undefined
    }
    writeU32(nwritten, total)
    return 0
  }
  function fdRead(fd: number, iovs: number, count: number, nread: number): MaybePromise<number> {
    if (fd !== 0) return 8
    const attempt = (): number | null => {
      const view = new DataView(memory().buffer)
      let total = 0
      for (let i = 0; i < count; i++) {
        const p = view.getUint32(iovs + i * 8, true)
        const l = view.getUint32(iovs + i * 8 + 4, true)
        const c = stdin.read(l)
        if (!c) break
        bytes(p, c.length).set(c)
        total += c.length
        if (c.length < l) break
      }
      if (total) {
        writeU32(nread, total)
        return 0
      }
      return null
    }
    const imm = attempt()
    if (imm !== null) return imm
    if (stdin.closed) {
      writeU32(nread, 0)
      return 0
    }
    return stdin.wait().then(() => {
      const r = attempt()
      if (r !== null) return r
      writeU32(nread, 0)
      return 0
    })
  }
  function pollOneoff(subscriptions: number, events: number, count: number, nevents: number): MaybePromise<number> {
    const view = new DataView(memory().buffer)
    for (let i = 0; i < count; i++) {
      const base = subscriptions + i * 48
      if (view.getUint8(base + 8) === 1 && stdin.chunks.length) {
        bytes(events, 32).fill(0)
        bytes(events, 8).set(bytes(base, 8))
        view.setUint8(events + 10, 1)
        writeU32(nevents, 1)
        return 0
      }
    }
    let timeout: number | null = null
    for (let i = 0; i < count; i++) {
      const base = subscriptions + i * 48
      if (view.getUint8(base + 8) === 0) timeout = Number(view.getBigUint64(base + 24, true) / 1000000n)
    }
    return stdin.wait(timeout === null ? undefined : timeout).then(() => {
      bytes(events, 32).fill(0)
      bytes(events, 8).set(bytes(subscriptions, 8))
      writeU32(nevents, 1)
      return 0
    })
  }
  const unavailable = () => 52

  // ---- fx http 流式 ----
  function headersObj(ptr: number, len: number): Record<string, string> {
    const h: Record<string, string> = {}
    for (const { name, value } of JSON.parse(text(ptr, len) || '[]') as Array<{ name: string; value: string }>) h[name] = value
    return h
  }
  function streamOpen(mp: number, ml: number, up: number, ul: number, hp: number, hl: number, bp: number, bl: number): number {
    const handle = nextHandle++
    const state: StreamState = {
      response: null,
      reader: null,
      responseError: null,
      settled: Promise.resolve(),
      pendingRead: null,
      readResult: null,
      readError: null,
      leftover: new Uint8Array(),
    }
    streams.set(handle, state)
    state.settled = Promise.resolve()
      .then(() =>
        env.fetch(text(up, ul), {
          method: text(mp, ml),
          headers: headersObj(hp, hl),
          body: bl ? bytes(bp, bl).slice() : undefined,
        }),
      )
      .then((r) => {
        state.response = r
        state.abort = () => r.abort?.()
      })
      .catch((e) => {
        state.responseError = e
      })
    return handle
  }
  function streamStatus(handle: number, statusOut: number): MaybePromise<number> {
    const st = streams.get(handle)
    if (!st) return -1
    const settled = (): number => {
      if (st.responseError) return -1
      if (!st.response) return 0
      new DataView(memory().buffer).setUint16(statusOut, st.response.status, true)
      return 1
    }
    const imm = settled()
    if (imm !== 0) return imm
    return st.settled.then(() => settled())
  }
  function streamNext(handle: number, outPtr: number, outCap: number): MaybePromise<number> {
    const st = streams.get(handle)
    if (!st) return -1
    const copy = (chunk: Uint8Array): number => {
      const w = chunk.subarray(0, outCap)
      bytes(outPtr, w.length).set(w)
      st.leftover = chunk.subarray(w.length)
      return w.length
    }
    const consume = (): number | null => {
      if (st.leftover.length) return copy(st.leftover)
      if (st.readError) return -1
      if (!st.readResult) return null
      const { done, value } = st.readResult
      st.readResult = null
      if (done) return 0
      if (!value?.length) return null
      options.onTransportChunk?.(value.length)
      return copy(value)
    }
    const imm = consume()
    if (imm !== null) return imm
    if (!st.reader && st.response?.body) st.reader = st.response.body
    if (!st.reader) return 0
    if (!st.pendingRead) {
      st.pendingRead = st.reader.read().then(
        (r) => {
          st.readResult = r
          st.pendingRead = null
        },
        (e) => {
          st.readError = e
          st.pendingRead = null
        },
      )
    }
    return st.pendingRead.then(() => {
      const r = consume()
      return r === null ? -3 : r
    })
  }

  function httpRequest(mp: number, ml: number, up: number, ul: number, hp: number, hl: number, bp: number, bl: number, statusOut: number, responsePtr: number, responseCap: number): Promise<number> {
    return Promise.resolve()
      .then(() =>
        env.fetch(text(up, ul), {
          method: text(mp, ml),
          headers: headersObj(hp, hl),
          body: bl ? bytes(bp, bl).slice() : undefined,
        }),
      )
      .then(async (r) => {
        const body = new Uint8Array(await r.arrayBuffer())
        new DataView(memory().buffer).setUint16(statusOut, r.status, true)
        if (body.length > responseCap) return -2
        bytes(responsePtr, body.length).set(body)
        return body.length
      })
      .catch(() => -1)
  }

  let pendingToolResult: Uint8Array | null = null
  function hostToolCall(np: number, nl: number, ap: number, al: number, op: number, oc: number, statusPtr: number, cip: number, cil: number): MaybePromise<number> {
    pendingToolResult = null
    if (typeof options.hostToolExecutor !== 'function') return -1
    let input: unknown
    try {
      input = JSON.parse(text(ap, al))
    } catch {
      return -1
    }
    return Promise.resolve(options.hostToolExecutor(text(np, nl), input, undefined, text(cip, cil))).then((res) => {
      if (res.cancelled) return -2
      const out = encoder.encode(res.content)
      bytes(statusPtr, 1)[0] = (res.isError ? 1 : 0) + (res.rich ? 2 : 0)
      if (out.length > oc) {
        if (!res.rich || out.length > 8 * 1024 * 1024) return -3
        pendingToolResult = out
        return out.length
      }
      bytes(op, out.length).set(out)
      return out.length
    }).catch(() => -1)
  }

  function steeringTake(op: number, oc: number): number {
    const e = steering[0]
    if (!e) return 0
    const id = encoder.encode(e.id)
    const l = id.length + 1 + e.value.length
    if (l > oc) return -1
    const out = bytes(op, oc)
    out.set(id, 0)
    out[id.length] = 10
    out.set(e.value, id.length + 1)
    steering.shift()
    steeringBytes -= e.value.length
    return l
  }
  function abortHostEffects(): void {
    pendingToolResult = null
    streams.forEach((s) => s.abort?.())
    streams.clear()
  }

  const wasi: Record<string, unknown> = {
    args_sizes_get(c: number, s: number) {
      writeU32(c, args.length)
      writeU32(s, args.reduce((n, v) => n + encoder.encode(v).length + 1, 0))
      return 0
    },
    args_get(p: number, d: number) {
      writeVector(args, p, d)
      return 0
    },
    environ_sizes_get(c: number, s: number) {
      writeU32(c, environ.length)
      writeU32(s, environ.reduce((n, v) => n + encoder.encode(v).length + 1, 0))
      return 0
    },
    environ_get(p: number, d: number) {
      writeVector(environ, p, d)
      return 0
    },
    fd_write: suspending(fdWrite),
    fd_read: suspending(fdRead),
    fd_close() {
      return 0
    },
    fd_fdstat_get(fd: number, out: number) {
      bytes(out, 24).fill(0)
      const v = new DataView(memory().buffer)
      v.setUint8(out, fd <= 2 ? 2 : 0)
      v.setBigUint64(out + 8, 0xffffffffffffffffn, true)
      v.setBigUint64(out + 16, 0xffffffffffffffffn, true)
      return 0
    },
    fd_filestat_get: unavailable,
    fd_filestat_set_size: unavailable,
    fd_filestat_set_times: unavailable,
    fd_pread: unavailable,
    fd_pwrite: unavailable,
    fd_readdir: unavailable,
    fd_prestat_get() {
      return 8
    },
    fd_prestat_dir_name: unavailable,
    fd_seek() {
      return 29
    },
    fd_sync() {
      return 0
    },
    clock_res_get(_id: number, out: number) {
      writeU64(out, 1000000n)
      return 0
    },
    clock_time_get(_id: number, _p: number, out: number) {
      writeU64(out, BigInt(Date.now()) * 1000000n)
      return 0
    },
    path_create_directory: unavailable,
    path_filestat_get: unavailable,
    path_filestat_set_times: unavailable,
    path_link: unavailable,
    path_open: unavailable,
    path_readlink: unavailable,
    path_remove_directory: unavailable,
    path_rename: unavailable,
    path_symlink: unavailable,
    path_unlink_file: unavailable,
    random_get(ptr: number, len: number) {
      env.getRandomValues(bytes(ptr, len))
      return 0
    },
    poll_oneoff: suspending(pollOneoff),
    proc_exit(code: number): never {
      markExited(code)
      throw new env.WasmExit(`proc_exit(${code})`)
    },
  }

  const fx: Record<string, unknown> = {
    fx_term_poll_input: suspending((t: number) => {
      if (stdin.chunks.length) return 1
      if (stdin.closed) return -1
      if (t === 0) return 0
      return stdin.wait(t >= 0 ? t : undefined).then(() => (stdin.chunks.length ? 1 : stdin.closed ? -1 : 0))
    }),
    fx_clipboard_copy: suspending(() => Promise.resolve(0)),
    fx_prompt_history_available() {
      return 0
    },
    fx_workspace_available() {
      return 0
    },
    fx_workspace_info() {
      return -2
    },
    fx_workspace_exec: suspending(() => Promise.resolve(-2)),
    fx_workspace_read_file: suspending(() => Promise.resolve(-2)),
    fx_http_stream_open: streamOpen,
    fx_http_stream_status: suspending(streamStatus),
    fx_http_stream_next: suspending(streamNext),
    fx_http_stream_close(h: number) {
      streams.get(h)?.abort?.()
      streams.delete(h)
    },
    fx_http_request: suspending(httpRequest),
    fx_host_tool_call: suspending(hostToolCall),
    fx_journal_flush: suspending(() =>
      Promise.resolve(typeof options.journalFlush === 'function' ? options.journalFlush().then(() => 0, () => -1) : -1),
    ),
    fx_host_tool_result_read(off: number, ptr: number, cap: number) {
      if (!pendingToolResult || off < 0 || off > pendingToolResult.length) return -1
      const c = pendingToolResult.subarray(off, off + cap)
      bytes(ptr, c.length).set(c)
      return c.length
    },
    fx_host_tool_result_release() {
      pendingToolResult = null
    },
    fx_steering_take: steeringTake,
    fx_steering_close() {
      steeringOpen = false
      steering.length = 0
      steeringBytes = 0
      steeringHandoff = false
    },
    fx_steering_state() {
      return steeringOpen ? steering.length * 2 + (steeringHandoff ? 1 : 0) : -1
    },
    fx_attachment_size() {
      return -1
    },
    fx_attachment_take() {
      return -1
    },
    fx_attachment_put() {
      return -1
    },
    fx_open_url: suspending(() => Promise.resolve(0)),
    fx_oauth_session_load: suspending(() => Promise.resolve(-2)),
    fx_oauth_session_commit: suspending(() => Promise.resolve(-1)),
    fx_oauth_session_remove: suspending(() => Promise.resolve(-1)),
    fx_config_get: suspending(() => Promise.resolve(-2)),
    fx_config_set: suspending(() => Promise.resolve(0)),
    fx_prompt_history_load: suspending(() => Promise.resolve(-1)),
    fx_prompt_history_append: suspending(() => Promise.resolve(-1)),
    fx_prompt_history_clear: suspending(() => Promise.resolve(-1)),
    fx_session_load: suspending(() => Promise.resolve(-2)),
    fx_session_commit: suspending(() => Promise.resolve(-1)),
    fx_session_list: suspending(() => Promise.resolve(-2)),
    fx_session_remove: suspending(() => Promise.resolve(-1)),
    fx_term_size(cols: number, rows: number) {
      const v = new DataView(memory().buffer)
      v.setUint16(cols, 80, true)
      v.setUint16(rows, 24, true)
    },
  }

  const api: FxRuntime = {
    imports: { wasi_snapshot_preview1: wasi, fx },
    exited,
    get exitCode() {
      return exitCode
    },
    get aborted() {
      return aborted
    },
    get error() {
      return abortError
    },
    write(d: string | Uint8Array) {
      stdin.push(typeof d === 'string' ? encoder.encode(d) : d)
    },
    wake() {
      stdin.wake()
    },
    closeStdin() {
      steeringOpen = false
      stdin.close()
    },
    openSteering() {
      steering.length = 0
      steeringBytes = 0
      steeringHandoff = false
      steeringOpen = true
    },
    closeSteering() {
      steeringOpen = false
      steering.length = 0
    },
    abort(e?: unknown) {
      aborted = true
      abortError = e
      abortHostEffects()
      stdin.close()
      markExited(130)
    },
    setStdoutHandler(fn) {
      stdoutHandler = fn
    },
    async start(wasmPath: string) {
      const { instance: inst } = await env.instantiate(wasmPath, api.imports)
      instance = inst
      exports_ = inst.exports
      // asyncify buffer：单独 grow 一页，Zig allocator 不复用宿主先占的页
      const pageIndex = (exports_.memory as { grow(d: number): number }).grow(1)
      dataAddr = pageIndex * ASYNCIFY_PAGE_BYTES
      const view = new DataView(exports_.memory.buffer as ArrayBuffer)
      view.setUint32(dataAddr, dataAddr + 8, true)
      view.setUint32(dataAddr + 4, dataAddr + ASYNCIFY_PAGE_BYTES, true)
      running = true
      try {
        exports_._start()
      } catch (e) {
        onStartError(e)
      }
      return api
    },
  }
  return api
}
