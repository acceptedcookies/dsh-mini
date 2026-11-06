// vfs × fx 合并测试：DevTools 模拟器内实测五根 VFS + 热视图 + 上传/图片/tool.call 文件分析。
// Phase A: VFS 单元面（evaluate 直达 getApp().globalData.__vfs）
// Phase B: read-view 热视图（capture → manifest 页读 → range 读 → digest 稳定/变更）
// Phase C: 上传 → tool.call 对文件的识别与分析（UI send 原生入口）
// Phase D: 图片识别（pendingImages → image block → 视觉描述）
// Phase E: file_write 工具调用（模型经 VFS 落文件）
// 用法: node scripts/vfs-agentic-test.mjs [--skip-turns]
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import zlib from "node:zlib";
import { connectIde } from "./dev-cli/lib/ide.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const skipTurns = process.argv.includes("--skip-turns");
const log = (...a) => console.log("[vfs-agentic]", ...a);
const pageData = (page) => page.data();

// ---------- 本地 PNG 生成（纯色方块，视觉模型可识别） ----------
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function solidPng(w, h, r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3)]);
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    row.copy(raw, y * (1 + w * 3));
    for (let x = 0; x < w; x++) {
      const o = y * (1 + w * 3) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
const RED_PNG_B64 = solidPng(96, 96, 220, 30, 30).toString("base64");

async function waitFor(getPage, pred, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const data = await pageData(await getPage());
      last = data;
      if (pred(data)) return data;
    } catch (e) {
      log(`waitFor retry (${label}): ${String(e?.message ?? e).slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timeout waiting ${label}: ${JSON.stringify(last?.state?.current?.items?.slice(-3) ?? last)}`);
}

async function sendPrompt(getPage, text) {
  const page = await getPage();
  await page.setData({ input: text });
  await page.callMethod("send");
}

// 连接契约收敛至 scripts/dev-cli/lib/ide.mjs：AUTO_PORT/ws9420 → cli auto 回退。
async function launchAndConnect() {
  const { mp } = await connectIde({ project: root });
  return mp;
}

async function relaunchTo(miniProgram, path, match) {
  for (let i = 0; i < 12; i++) {
    const p = await miniProgram.currentPage().catch(() => null);
    if (p !== null && p.path.includes(match)) return;
    await miniProgram.reLaunch(path).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`relaunch to ${path} did not take effect`);
}

async function main() {
  const miniProgram = await launchAndConnect();
  log("connected");
  const result = { phases: {}, turns: [] };
  const getPage = async () => {
    const p = await miniProgram.currentPage();
    if (!p.path.includes("workspace")) throw new Error(`unexpected page ${p.path}`);
    return p;
  };
  try {
    await relaunchTo(miniProgram, "/pages/workspace/workspace", "workspace");
    await new Promise((r) => setTimeout(r, 2000));
    await waitFor(getPage, (d) => d.state?.loadingSessions === false, 30000, "boot");
    await (await getPage()).callMethod("newSession");
    const sessData = await waitFor(getPage, (d) => d.state?.current?.sessionId != null, 15000, "session");
    const sessionId = sessData.state.current.sessionId;
    log("session:", sessionId);

    // ---------- Phase A: VFS 单元面 ----------
    // 先清 VFS storage——行/manifest 跨 run 持久化，脏 population 会污染断言
    await miniProgram.evaluate(() => {
      wx.removeStorageSync("dsh:vfs:v1:rows");
      wx.removeStorageSync("dsh:vfs:v1:manifests");
      return true;
    });
    const phaseA = await miniProgram.evaluate(
      (sid) => {
        const { vfs } = getApp().globalData.__vfs;
        const out = {};
        vfs.write("/root/readme.md", "hub file from root lane", { sessionId: sid });
        vfs.write("/tmp/scratch.txt", "scratch bytes", { sessionId: sid });
        vfs.write(`notes.txt`, "session file alpha=42 beta=hello", { sessionId: sid });
        vfs.write(`${vfs.cwd(sid)}/data.csv`, "city,score\ntokyo,88\nosaka,77", { sessionId: sid });
        out.rootList = vfs.list("/", { sessionId: sid }).entries.map((e) => e.path);
        out.dataList = vfs.list(`/data/${sid}`, { sessionId: sid }).entries.map((e) => e.name);
        out.readBack = vfs.read(`/data/${sid}/notes.txt`, { sessionId: sid }).text;
        out.stat = vfs.stat(`/data/${sid}/data.csv`, { sessionId: sid });
        const errs = {};
        for (const [k, fn] of Object.entries({
          workspaceAlias: () => vfs.write("/workspace/x", "x", { sessionId: sid }),
          escape: () => vfs.write("/data/../evil", "x", { sessionId: sid }),
          mntWrite: () => vfs.write("/mnt/m/f", "x", { sessionId: sid }),
          backupWrite: () => vfs.write("/backup/b/f", "x", { sessionId: sid }),
          artifacts: () => vfs.write(`/data/${sid}/artifacts/r`, "x", { sessionId: sid }),
          crossSession: () => vfs.write("/data/other-sess/f", "x", { sessionId: sid }),
          mntList: () => vfs.list("/mnt/m", { sessionId: sid }),
        })) {
          try {
            fn();
            errs[k] = "NOT-REJECTED";
          } catch (e) {
            errs[k] = e.code ?? e.name;
          }
        }
        out.errors = errs;
        out.mntRootList = vfs.list("/mnt", { sessionId: sid }).entries.length;
        return out;
      },
      sessionId,
    );
    result.phases.A = phaseA;
    log("A:", JSON.stringify(phaseA));
    if (phaseA.rootList.length !== 5) throw new Error("A: / 未恒列五根");
    if (!phaseA.readBack.includes("alpha=42")) throw new Error("A: 读回内容不符");
    if (phaseA.errors.workspaceAlias !== "unsafe-workspace-path") throw new Error("A: /workspace 别名未拒");
    if (phaseA.errors.escape !== "unsafe-workspace-path") throw new Error("A: .. 逃逸未拒");
    if (phaseA.errors.mntWrite !== "read-only-path") throw new Error("A: /mnt 写未拒");
    if (phaseA.errors.backupWrite !== "read-only-path") throw new Error("A: /backup 写未拒");
    if (phaseA.errors.artifacts !== "read-only-path") throw new Error("A: artifacts 保留面未拒");
    if (phaseA.errors.crossSession !== "unsafe-workspace-path") throw new Error("A: 跨 session 写未拒");
    if (phaseA.errors.mntList !== "path-not-found") throw new Error("A: /mnt 名读未拒");

    // ---------- Phase B: 热视图 ----------
    const phaseB = await miniProgram.evaluate(
      (sid) => {
        const { vfs, vfsReadView } = getApp().globalData.__vfs;
        const out = {};
        const c1 = vfsReadView.capture();
        const c2 = vfsReadView.capture();
        out.digestStable = c1.root_digest === c2.root_digest;
        out.population = c1.population_count;
        const p1 = vfsReadView.readManifestPage(c1.manifest_uuid, undefined, 2);
        const p2 = vfsReadView.readManifestPage(c1.manifest_uuid, p1.next_cursor, 10);
        out.pageSizes = [p1.entries.length, p2.entries.length];
        out.pageUnion = [...p1.entries, ...p2.entries].length;
        const range = vfsReadView.readObjectRange(c1.manifest_uuid, `/data/${sid}/notes.txt`, 0, 24);
        out.rangeText = range.bytes;
        out.rangeVersion = range.object_version.slice(0, 16);
        vfs.write(`/data/${sid}/newer.txt`, "post-capture mutation", { sessionId: sid });
        const c3 = vfsReadView.capture();
        out.digestChanged = c3.root_digest !== c1.root_digest;
        const stale = vfsReadView.readManifestPage(c1.manifest_uuid, undefined, 50);
        // 精确匹配本 session 的新文件——storage 跨 run 持久化，旧 run 的同名文件不算泄漏
        out.staleSeesNew = stale.entries.some((e) => e.normalized_path === `/data/${sid}/newer.txt`);
        return out;
      },
      sessionId,
    );
    result.phases.B = phaseB;
    log("B:", JSON.stringify(phaseB));
    if (!phaseB.digestStable) throw new Error("B: 同 population 两次 capture digest 不稳");
    if (!phaseB.digestChanged) throw new Error("B: mutation 后 digest 未变");
    if (phaseB.staleSeesNew) throw new Error("B: 旧 manifest 见到新 mutation（应为有界陈旧快照）");
    if (!phaseB.rangeText.includes("alpha=42")) throw new Error("B: range 读内容不符");

    if (!skipTurns) {
      // ---------- Phase C: 上传 → tool.call 文件分析 ----------
      log("C: upload fixture → tool.call");
      await miniProgram.evaluate(
        (sid) => {
          const fsm = wx.getFileSystemManager();
          const tmp = `${wx.env.USER_DATA_PATH}/vfs-fixture-upload.csv`;
          fsm.writeFileSync(tmp, "product,revenue\nalpha,1200\nbeta,3400\ngamma,900", "utf8");
          const { vfs } = getApp().globalData.__vfs;
          return vfs.ingestLocal(tmp, `/data/${sid}/uploaded/revenue.csv`, { sessionId: sid, mime: "text/csv" });
        },
        sessionId,
      );
      const baseC = (await pageData(await getPage())).state?.current?.items?.filter((i) => i.kind === "assistant_message").length ?? 0;
      await sendPrompt(
        getPage,
        "Use the file_read tool to read /data/" + sessionId + "/uploaded/revenue.csv, then tell me which product has the highest revenue in one short sentence.",
      );
      const tc = await waitFor(
        getPage,
        (d) => {
          const items = d.state?.current?.items ?? [];
          const fileTool = items.some((i) => i.kind === "tool_call" && i.tool === "file_read" && i.status === "ok");
          const msgs = items.filter((i) => i.kind === "assistant_message");
          return fileTool && msgs.length > baseC;
        },
        180000,
        "phaseC file_read",
      );
      const cItems = tc.state.current.items;
      const cTool = cItems.filter((i) => i.kind === "tool_call" && i.tool === "file_read").pop();
      const cMsg = cItems.filter((i) => i.kind === "assistant_message").pop();
      const cResult = cItems.filter((i) => i.kind === "tool_result").pop();
      result.turns.push({ phase: "C", tool: cTool?.tool, toolDetail: (cResult?.detail ?? "").slice(0, 160), answer: (cMsg?.text ?? "").slice(0, 240) });
      log("C done:", JSON.stringify(result.turns[result.turns.length - 1]));
      if (!/beta/i.test(cMsg?.text ?? "")) log("WARN: 答案未提 beta（fixture 最高收入项）——模型未忠实使用文件内容");

      // ---------- Phase D: 图片识别 ----------
      log("D: image attach → vision prompt");
      const imgPath = await miniProgram.evaluate(
        (b64) => {
          const fsm = wx.getFileSystemManager();
          const p = `${wx.env.USER_DATA_PATH}/vfs-fixture-image.png`;
          fsm.writeFileSync(p, b64, "base64");
          return p;
        },
        RED_PNG_B64,
      );
      const baseD = (await pageData(await getPage())).state?.current?.items?.filter((i) => i.kind === "assistant_message").length ?? 0;
      const pageD = await getPage();
      await pageD.setData({
        input: "What color is this image? Answer in one word.",
        pendingImages: [{ id: "img-fixture", url: imgPath }],
      });
      await pageD.callMethod("send");
      const td = await waitFor(
        getPage,
        (d) => (d.state?.current?.items ?? []).filter((i) => i.kind === "assistant_message").length > baseD,
        180000,
        "phaseD image turn",
      );
      const dMsg = td.state.current.items.filter((i) => i.kind === "assistant_message").pop();
      result.turns.push({ phase: "D", answer: (dMsg?.text ?? "").slice(0, 240), mentionsRed: /red|红/i.test(dMsg?.text ?? "") });
      log("D done:", JSON.stringify(result.turns[result.turns.length - 1]));

      // ---------- Phase E: file_write 工具调用 ----------
      log("E: file_write via tool.call");
      const baseE = (await pageData(await getPage())).state?.current?.items?.filter((i) => i.kind === "assistant_message").length ?? 0;
      await sendPrompt(
        getPage,
        `Use the file_write tool to create the file /tmp/summary-note.txt with the content "vfs-write-ok". Then confirm in one word.`,
      );
      await waitFor(
        getPage,
        (d) => {
          const items = d.state?.current?.items ?? [];
          const w = items.some((i) => i.kind === "tool_call" && i.tool === "file_write" && i.status === "ok");
          const msgs = items.filter((i) => i.kind === "assistant_message");
          return w && msgs.length > baseE;
        },
        180000,
        "phaseE file_write",
      );
      const eStat = await miniProgram.evaluate(() => {
        const { vfs } = getApp().globalData.__vfs;
        try {
          const r = vfs.read("/tmp/summary-note.txt", { sessionId: "any" });
          return { exists: true, text: r.text };
        } catch (e) {
          return { exists: false, error: e.code ?? e.message };
        }
      });
      result.turns.push({ phase: "E", stat: eStat });
      log("E done:", JSON.stringify(eStat));
      if (!eStat.exists || !eStat.text.includes("vfs-write-ok")) throw new Error("E: file_write 未落 VFS 真源");
    }

    result.verdict = "PASS";
    log("PASS", JSON.stringify(result, null, 1));
    return 0;
  } catch (e) {
    result.verdict = "FAIL";
    result.error = String(e?.message ?? e);
    log("FAIL", JSON.stringify(result, null, 1));
    return 1;
  } finally {
    await miniProgram.close().catch(() => {});
  }
}

process.exit(await main());
