// app.ts
import { engine } from './services/skin/engine'
import { errorBus, reportSilent } from './services/error-report'
import { sessionDiagnostics } from './services/diagnostics'
import { setVfsMirrorHook, setVfsMirrorPredicate } from './services/vfs/vfs'
import { recoverPendingDeletes, pendingSummary } from './services/vfs/remote-sync'
import { nanoMiniCatchUp, nanoMiniStartTick, nanoMiniStopTick } from './services/nano-mini-host/tick'
import { vfsSyncFor } from './services/state/provider'
import { engineForSession } from './services/session-engine'
import { hasFreshTicket, onTicketMinted } from './services/fx/ticket'

/** cloud 车道 VFS 远端镜像接线（MN02 G1 durable lane 活线）：
 *  写/删 → fire-and-forget 推送（失败 warn 不阻塞本地写——reconcile 兜底自愈）；
 *  reconcile：远端清单/行下拉（updated_ms 大者赢）→ 本地行推送（指针增量）。 */
function wireRemoteMirror(): void {
  let inFlight: Promise<void> | undefined
  // 会话车道分界（MN03 引擎戳记）：/data/{sid}/ 下 magpie 会话的文件是纯
  // 本地车道——不镜像上行；非会话行（/root 等）无引擎归属照常全局镜像。
  const isMirrored = (path: string): boolean => {
    const m = /^\/data\/([^/]+)\//.exec(path)
    return !(m !== null && engineForSession(m[1]) === 'magpie')
  }
  // 删除意图的镜像 lane 判定与 mirrorHook 同源：/tmp 由 vfs 层排除，
  // magpie 会话行不落碑（T-O-7；避免污染 512 墓碑预算）。
  setVfsMirrorPredicate(isMirrored)

  // 启动恢复先于 reconcile 的 ticket 门控：pending 碑只依赖本地 row/碑。
  try {
    const rec = recoverPendingDeletes()
    if (rec.removed.length > 0 || rec.kept.length > 0) {
      console.warn(`[vfs-mirror] recover pending deletes: removed=${rec.removed.length} kept=${rec.kept.length}`)
    }
  } catch (e) {
    reportSilent(e, { op: 'vfs-recover-delete', lane: 'background' })
  }

  const doReconcile = async (): Promise<void> => {
    // 句柄每次重解析——remote-durable 开关/配置翻转即时生效，不吃启动时陈旧快照（审查三轮）。
    const s = vfsSyncFor()
    if (s === null) return
    try {
      await s.pullWorkspaces()
      const pulled = await s.pullRows()
      for (const p of pulled) await s.hydrate(p)
      // 行在字节失（cache 清理）不只在 pulled 集内——全量缺失面自愈（审查三轮 N4）。
      await s.hydrateMissing()
      const rep = await s.pushAll()
      if (rep.failed.length > 0) {
        console.warn('[vfs-mirror] reconcile 残留失败:', rep.failed)
        const ps = pendingSummary()
        reportSilent(new Error(`vfs reconcile 残留失败 ${rep.failed.length} 行`), { op: 'vfs-mirror', lane: 'background', detail: `pending=${ps.unsynced_rows} tombstones=${ps.tombstones.pending}/${ps.tombstones.committed}\n${rep.failed.map((f) => `${f.path}: ${f.error}`).join('\n').slice(0, 700)}` })
      }
    } catch (e) {
      console.warn('[vfs-mirror] reconcile 失败（远端不可达——写路径仍先推）:', e instanceof Error ? e.message : e)
      // 后台 reconcile 是 best-effort 兜底——silent 台账不弹（MN03-R1）。
      reportSilent(e, { op: 'vfs-mirror', lane: 'background' })
    }
  }
  // 后台面铁律：无活票据不碰远端——铸票=SOTER 须用户手势上下文（审查 B8）。
  // 票据铸成（onTicketMinted）即 reconcile 兜底全部跳过/失败的上行；in-flight 单飞防重入。
  const reconcile = (): void => {
    if (!hasFreshTicket() || inFlight !== undefined) return
    inFlight = doReconcile().finally(() => { inFlight = undefined })
  }
  setVfsMirrorHook((path, kind) => {
    if (!hasFreshTicket()) return
    if (!isMirrored(path)) return
    const s = vfsSyncFor()
    if (s === null) return
    const p = kind === 'write' ? s.pushPath(path) : s.pushRemove(path)
    p.then(() => reconcile()).catch((e) => {
      console.warn(`[vfs-mirror] ${kind} ${path} 推送失败（reconcile 兜底）:`, e instanceof Error ? e.message : e)
      // 高频面——每次写都可能撞远端不可达，仅入 silent 台账不弹（reconcile 兜底）。
      reportSilent(e, { op: 'vfs-push', lane: 'background', path })
    })
  })
  onTicketMinted(() => reconcile())
  reconcile()
}

App<IAppOption>({
  globalData: {
    theme: engine.eff,
    /** DevTools 调试面（非测试套件）：session 诊断 bundle 与错误总线注入。
     *  VFS/durable/claim/session 等测试专用钩子已随测试套件拆除。 */
    __diagnostics: sessionDiagnostics as unknown,
    __errorBus: errorBus as unknown,
  },
  onLaunch() {
    engine.init()
    this.globalData.theme = engine.eff
    engine.watchMode((theme) => {
      this.globalData.theme = theme
    })
    // 纯资源分包下载由 app.json preloadRule（workspace 页）触发；
    // 消费端各自轮询等待（loadKernelAsync / instantiate 重试），launch 无需预热调用
    // T-O-9：启动 catch-up（sweep due 闹钟/恢复挂起 turn）——catch 住防 unhandled rejection
    nanoMiniCatchUp().catch((e) => {
      console.warn('[nano-mini] catchUp failed:', e)
      reportSilent(e, { op: 'catch-up', lane: 'background' })
    })
    wireRemoteMirror()
  },
  onShow() {
    // T-O-9：前台 30s tick
    nanoMiniStartTick()
  },
  onHide() {
    // T-O-9：停 interval + 落 pending-catchup 标记
    nanoMiniStopTick()
  },
})
 