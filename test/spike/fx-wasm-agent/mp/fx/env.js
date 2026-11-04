// WX 宿主能力适配：WXWebAssembly.instantiate + wx.request 分块 fetch + UTF-8/随机数兜底。

function encodeUtf8(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(++i);
      c = ((c - 0xd800) << 10) + c2 - 0xdc00 + 0x10000;
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

function decodeUtf8(b) {
  let s = "", i = 0;
  while (i < b.length) {
    const c = b[i++];
    if (c < 0x80) { s += String.fromCharCode(c); continue; }
    let code, n;
    if (c < 0xe0) { code = c & 0x1f; n = 1; }
    else if (c < 0xf0) { code = c & 0x0f; n = 2; }
    else { code = c & 0x07; n = 3; }
    for (let j = 0; j < n; j++) code = (code << 6) | (b[i++] & 0x3f);
    if (code < 0x10000) s += String.fromCharCode(code);
    else { const v = code - 0x10000; s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); }
  }
  return s;
}

const NativeTE = typeof TextEncoder !== "undefined" ? TextEncoder : class { encode(s) { return encodeUtf8(s); } };
const NativeTD = typeof TextDecoder !== "undefined" ? TextDecoder : class { decode(b) { return decodeUtf8(b); } };

// 随机数：优先 crypto.getRandomValues / wx.getRandomValues，缺位用 xorshift（spike 非密码学用途）。
let seed = (Date.now() ^ 0x9e3779b9) >>> 0;
function getRandomValues(arr) {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) return crypto.getRandomValues(arr);
  if (typeof wx !== "undefined" && typeof wx.getRandomValues === "function") return wx.getRandomValues(arr);
  for (let i = 0; i < arr.length; i++) {
    seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0;
    arr[i] = seed & 0xff;
  }
  return arr;
}

// wx.request → fetch 形态：onHeadersReceived 时 resolve，body.read() 逐块取。
export function wxFetch(url, init) {
  return new Promise((resolve, reject) => {
    const queue = [];
    let ended = false, failed = null, status = 0;
    const waiters = [];
    const wake = () => { waiters.splice(0).forEach((w) => w()); };
    let settled = false;

    const response = {
      get status() { return status; },
      body: {
        read() {
          if (queue.length) return Promise.resolve({ done: false, value: queue.shift() });
          if (ended) return Promise.resolve({ done: true, value: undefined });
          if (failed) return Promise.reject(failed);
          return new Promise((res) => {
            waiters.push(() => res(response.body.read()));
          });
        },
      },
      async arrayBuffer() {
        const parts = [];
        for (;;) {
          const r = await this.body.read();
          if (r.done) break;
          parts.push(r.value);
        }
        const total = parts.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(total);
        let off = 0; parts.forEach((p) => { out.set(p, off); off += p.length; });
        return out.buffer;
      },
      abort() { try { task.abort(); } catch {} },
    };

    const task = wx.request({
      url,
      method: init.method || "GET",
      data: init.body ? init.body.buffer.slice(init.body.byteOffset, init.body.byteOffset + init.body.byteLength) : undefined,
      header: init.headers || {},
      responseType: "arraybuffer",
      enableChunked: true,
      success(res) {
        if (res.data && res.data.byteLength) queue.push(new Uint8Array(res.data));
        ended = true; wake();
        if (!settled) { settled = true; status = res.statusCode; resolve(response); }
      },
      fail(err) {
        failed = new Error(`wx.request fail: ${JSON.stringify(err)}`); ended = true; wake();
        if (!settled) { settled = true; reject(failed); }
      },
    });
    if (task && typeof task.onHeadersReceived === "function") {
      task.onHeadersReceived((res) => {
        if (settled) return;
        settled = true; status = res.statusCode; resolve(response);
      });
    }
    if (task && typeof task.onChunkReceived === "function") {
      task.onChunkReceived((res) => {
        if (res.data && res.data.byteLength) { queue.push(new Uint8Array(res.data)); wake(); }
      });
    }
  });
}

class WasmExit extends Error {}

export function createWxEnv() {
  return {
    fetch: wxFetch,
    getRandomValues,
    instantiate: (path, imports) => WXWebAssembly.instantiate(path, imports),
    TextEncoder: NativeTE,
    TextDecoder: NativeTD,
    WasmExit,
  };
}
