import { vfs } from '../../services/vfs/vfs'
import { vfsStore } from '../../services/vfs/store'
import { localObjects } from '../../services/vfs/objects'
import { resolveVfsPath } from '../../services/vfs/paths'
import { vfsSyncMap } from '../../services/vfs/remote-sync'
import { errorBus } from '../../services/error-report'
import { formatRelative } from '../../utils/time'
import type { VfsListEntry } from '../../services/vfs/vfs'
import { engine } from '../../services/skin/engine'

/** 文件管理器行模型（本地 vfs 与 nano 远端列表共用）。 */
interface FileRow {
  path: string
  name: string
  kind: 'file' | 'dir'
  icon: string
  meta: string
  syncState: '' | 'local' | 'cloud' | 'pending' | 'readonly'
  syncLabel: string
  mime?: string
}

/** 该 session 视角下路径是否可写（只读 lane + 跨 session lane 一律不可写）。 */
function writableTo(path: string, sessionId: string): boolean {
  try {
    const r = resolveVfsPath(path, sessionId)
    if (r.readOnly) return false
    if (r.lane === 'session' && r.laneKey !== sessionId) return false
    return true
  } catch {
    return false
  }
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const FILE_ICON: Record<string, string> = {
  '.json': 'code-outline', '.ts': 'code-outline', '.js': 'code-outline',
  '.md': 'list-pen-outline', '.txt': 'list-pen-outline',
  '.zip': 'archive-outline', '.tar': 'archive-outline', '.gz': 'archive-outline',
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    /** 宽屏 dock 形态：fixed overlay → 内联列（宿主机位由页面 .rp-host 控制）。 */
    docked: { type: Boolean, value: false },
    active: { type: String, value: 'files' },
    tabs: { type: Array, value: [] },
    theme: { type: String, value: 'light' },
    files: { type: Array, value: [] },
    todos: { type: Array, value: [] },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' },
    connected: { type: Boolean, value: false },
    sessionId: { type: String, value: '' },
  },

  data: {
    layout: '',
    shellVars: '',
    navPath: '/',
    fileRows: [] as FileRow[],
    navErr: '',
    navLoading: false,
    /** 文件卡片弹窗（dsh-dialog 化——信息行 + 操作列，替原生 ActionSheet/showModal）。 */
    cardPath: '',
    cardTitle: '',
    cardInfo: [] as Array<{ label: string; value: string }>,
    cardWritable: false,
    /** 重命名弹窗（editable dsh-dialog）。 */
    renamePath: '',
    renameValue: '',
    renameVisible: false,
    /** 删除确认弹窗（danger dsh-dialog）。 */
    deletePath: '',
    deleteDesc: '',
    deleteVisible: false,
  },

  observers: {
    'visible, active, connected, sessionId'(visible: boolean, active: string) {
      if (visible && active === 'files') this.reloadFiles()
    },
    'files'(files: Array<{ path: string; size?: string; mime?: string }>) {
      if (this.data.connected && this.data.active === 'files') this.rowsFromRemote(files)
    },
  },

  lifetimes: {
    attached() {
      ;(this as unknown as { _unwatchSkin?: () => void })._unwatchSkin = engine.watchMode(() => {
        this.syncShell()
      })
      this.syncShell()
    },
    detached() {
      const unwatch = (this as unknown as { _unwatchSkin?: () => void })._unwatchSkin
      if (typeof unwatch === 'function') unwatch()
    },
  },
  methods: {
    syncShell() {
      const shellVars = engine.componentVars('right-panel')
      const layout = engine.componentLayout('right-panel')
      if (shellVars === this.data.shellVars && layout === this.data.layout) return
      this.setData({ shellVars, layout })
    },
    select(event: WechatMiniprogram.CustomEvent<{ id?: string }>) {
      const id = String(event.detail?.id ?? '')
      if (id.length > 0) this.triggerEvent('select', { id })
    },
    close() {
      this.triggerEvent('close')
    },
    refresh() {
      if (this.data.connected) this.triggerEvent('refresh')
      else this.reloadFiles()
    },
    noop() {
      // Keep taps inside the panel from reaching the page.
    },

    /** 本地车道：vfs.list 自驱浏览；nano 车道：files prop 投影（远端只读）。 */
    reloadFiles() {
      if (this.data.connected) {
        this.rowsFromRemote(this.data.files as Array<{ path: string; size?: string; mime?: string }>)
        return
      }
      this.loadLocal(this.data.navPath)
    },

    rowsFromRemote(files: Array<{ path: string; size?: string; mime?: string }>) {
      const rows: FileRow[] = files.map((f) => ({
        path: f.path,
        name: f.path.split('/').pop() ?? f.path,
        kind: 'file',
        icon: fileIcon(f.path),
        meta: [f.size ?? '', '云端'].filter(Boolean).join(' · '),
        syncState: 'cloud',
        syncLabel: '云端',
        ...(f.mime !== undefined ? { mime: f.mime } : {}),
      }))
      this.setData({ fileRows: rows, navErr: '' })
    },

    loadLocal(path: string) {
      const sid = this.data.sessionId
      this.setData({ navLoading: true, navErr: '' })
      try {
        const { entries } = vfs.list(path, { sessionId: sid })
        const sync = vfsSyncMap()
        const rows = entries.map((e) => this.rowOf(e, sync, sid))
        this.setData({ fileRows: rows, navPath: path, navLoading: false })
      } catch (e) {
        this.setData({
          fileRows: [],
          navLoading: false,
          navErr: e instanceof Error ? e.message : '目录读取失败',
        })
      }
    },

    rowOf(e: VfsListEntry, sync: Record<string, { synced_ms: number }>, sid: string): FileRow {
      const base: FileRow = {
        path: e.path,
        name: e.name,
        kind: e.kind,
        icon: e.kind === 'dir' ? 'folder-open-outline' : fileIcon(e.path),
        meta: '',
        syncState: '',
        syncLabel: '',
      }
      if (e.kind === 'dir') {
        base.meta = laneHint(e.path)
        return base
      }
      // 文件行：stat 取 updated_ms/placement 权威（list 投影无时间字段）。
      let updated: number | undefined
      let placement = e.placement
      let mime: string | undefined
      try {
        const st = vfs.stat(e.path, { sessionId: sid })
        updated = st.updated_ms
        placement = st.placement ?? placement
        mime = vfsStore.getRow(e.path)?.mime
      } catch { /* stat 失败降级为仅 size 显示 */ }
      const metaParts = [formatBytes(e.size_bytes)]
      if (updated !== undefined) metaParts.push(formatRelative(updated))
      base.meta = metaParts.filter(Boolean).join(' · ')
      if (mime !== undefined) base.mime = mime
      // 同步态：scratch 本义不镜像→本地；只读 lane→只读；指针水位→云端/待同步/本地。
      if (placement === 'local-scratch') {
        base.syncState = 'local'
        base.syncLabel = '本地'
      } else if (!writableTo(e.path, sid)) {
        base.syncState = 'readonly'
        base.syncLabel = '只读'
      } else {
        const ptr = sync[e.path]
        if (ptr === undefined) {
          base.syncState = 'local'
          base.syncLabel = '本地'
        } else {
          const current = updated === undefined || ptr.synced_ms >= updated
          base.syncState = current ? 'cloud' : 'pending'
          base.syncLabel = current ? '云端' : '待同步'
        }
      }
      return base
    },

    onNavBack() {
      const p = this.data.navPath
      if (p === '/') return
      const parent = p.slice(0, p.lastIndexOf('/')) || '/'
      this.loadLocal(parent)
    },

    onRowTap(event: WechatMiniprogram.TouchEvent) {
      const path = String(event.currentTarget.dataset.path ?? '')
      const kind = String(event.currentTarget.dataset.kind ?? '')
      if (!this.data.connected && kind === 'dir') {
        this.loadLocal(path)
        return
      }
      const row = this.data.fileRows.find((r) => r.path === path)
      if (row !== undefined) this.openCard(row)
    },

    onRowMenu(event: WechatMiniprogram.TouchEvent) {
      const path = String(event.currentTarget.dataset.path ?? '')
      const row = this.data.fileRows.find((r) => r.path === path)
      if (row !== undefined) this.openCard(row)
    },

    /** 文件卡片：信息行 + 操作列（详情/重命名/删除/复制路径同卡合一）。 */
    openCard(row: FileRow) {
      const info: Array<{ label: string; value: string }> = [
        { label: '路径', value: row.path },
        { label: '类型', value: row.kind === 'dir' ? '目录' : '文件' },
      ]
      const storeRow = this.data.connected ? undefined : vfsStore.getRow(row.path)
      const size = storeRow?.size_bytes
      if (size !== undefined) info.push({ label: '大小', value: formatBytes(size) })
      const mime = storeRow?.mime ?? row.mime
      if (mime !== undefined && mime.length > 0) info.push({ label: 'MIME', value: mime })
      const hash = storeRow?.content_hash
      if (hash !== undefined) info.push({ label: 'SHA256', value: `${hash.replace(/^sha256:/, '').slice(0, 16)}…` })
      const placement = storeRow?.placement
      if (placement !== undefined) info.push({ label: '存储', value: placement })
      if (storeRow?.updated_ms !== undefined) info.push({ label: '修改', value: formatRelative(storeRow.updated_ms) })
      if (row.syncLabel.length > 0) info.push({ label: '同步', value: row.syncLabel })
      const canWrite = !this.data.connected && row.kind === 'file' && writableTo(row.path, this.data.sessionId)
      this.setData({ cardPath: row.path, cardTitle: row.name, cardInfo: info, cardWritable: canWrite })
    },

    closeCard() {
      this.setData({ cardPath: '' })
    },

    onCardRename() {
      const path = this.data.cardPath
      const name = path.split('/').pop() ?? path
      this.setData({ cardPath: '', renamePath: path, renameValue: name, renameVisible: true })
    },

    onCardCopy() {
      const path = this.data.cardPath
      this.setData({ cardPath: '' })
      if (path.length > 0) wx.setClipboardData({ data: path })
    },

    onCardDelete() {
      const path = this.data.cardPath
      const name = this.data.cardTitle
      this.setData({
        cardPath: '',
        deletePath: path,
        deleteDesc: `确定删除「${name}」？此操作不可撤销。`,
        deleteVisible: true,
      })
    },

    onRenameCancel() {
      this.setData({ renameVisible: false, renamePath: '', renameValue: '' })
    },

    onRenameConfirm(event: WechatMiniprogram.CustomEvent<{ value?: string }>) {
      const from = this.data.renamePath
      const name = String(event.detail?.value ?? '').trim()
      this.setData({ renameVisible: false, renamePath: '', renameValue: '' })
      if (from.length === 0 || name.length === 0 || name === from.split('/').pop()) return
      if (/[/\\]|\.\./.test(name)) {
        wx.showToast({ title: '文件名不能含 / \\ ..', icon: 'none' })
        return
      }
      const dir = from.slice(0, from.lastIndexOf('/'))
      this.renameFile(from, `${dir}/${name}`)
    },

    onDeleteCancel() {
      this.setData({ deleteVisible: false, deletePath: '' })
    },

    onDeleteConfirm() {
      const path = this.data.deletePath
      this.setData({ deleteVisible: false, deletePath: '' })
      if (path.length === 0) return
      try {
        vfs.remove(path, { sessionId: this.data.sessionId })
        this.loadLocal(this.data.navPath)
      } catch (e) {
        errorBus.report(e, { op: 'vfs-delete', lane: 'ui', path })
      }
    },

    renameFile(from: string, to: string) {
      const sid = this.data.sessionId
      try {
        if (vfs.stat(to, { sessionId: sid }).exists) {
          wx.showToast({ title: '目标已存在', icon: 'none' })
          return
        }
        // VFS 无 rename 原语——对象字节原样搬迁+删旧行（同目录改名）；
        // 不经 text 通道——二进制文件 UTF-8 往返会丢字节（对象层原样搬）。
        const row = vfsStore.getRow(from)
        if (row === undefined) {
          wx.showToast({ title: '文件不存在', icon: 'none' })
          return
        }
        const bytes = localObjects.read(row.object_key)
        const mime = row.mime
        vfs.write(to, bytes, { sessionId: sid, ...(mime !== undefined ? { mime } : {}) })
        vfs.remove(from, { sessionId: sid })
        this.loadLocal(this.data.navPath)
      } catch (e) {
        errorBus.report(e, { op: 'vfs-rename', lane: 'ui', path: from })
      }
    },
  },
})

function fileIcon(path: string): string {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return 'list-pen-outline'
  return FILE_ICON[path.slice(dot).toLowerCase()] ?? 'list-pen-outline'
}

/** 目录行的 lane 提示（本地/挂载/备份/会话桶——五根语义一眼见）。 */
function laneHint(path: string): string {
  if (path === '/tmp') return '临时 · 不镜像'
  if (path === '/mnt') return '挂载 · 只读'
  if (path === '/backup') return '备份 · 只读'
  if (path === '/root') return '共享根'
  if (path === '/data') return '会话桶'
  if (path.startsWith('/mnt/')) return '挂载 · 只读'
  return ''
}
