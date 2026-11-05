import { vfs } from '../../services/vfs/vfs'
import { vfsStore } from '../../services/vfs/store'
import { localObjects } from '../../services/vfs/objects'
import { resolveVfsPath } from '../../services/vfs/paths'
import { vfsSyncMap } from '../../services/vfs/remote-sync'
import { errorBus } from '../../services/error-report'
import { formatRelative } from '../../utils/time'
import type { VfsListEntry } from '../../services/vfs/vfs'

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
    navPath: '/',
    fileRows: [] as FileRow[],
    navErr: '',
    navLoading: false,
  },

  observers: {
    'visible, active, connected, sessionId'(visible: boolean, active: string) {
      if (visible && active === 'files') this.reloadFiles()
    },
    'files'(files: Array<{ path: string; size?: string; mime?: string }>) {
      if (this.data.connected && this.data.active === 'files') this.rowsFromRemote(files)
    },
  },

  methods: {
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
      if (this.data.connected) {
        const row = this.data.fileRows.find((r) => r.path === path)
        if (row !== undefined) this.showDetail(row)
        return
      }
      if (kind === 'dir') {
        this.loadLocal(path)
        return
      }
      const row = this.data.fileRows.find((r) => r.path === path)
      if (row !== undefined) this.showDetail(row)
    },

    onRowMenu(event: WechatMiniprogram.TouchEvent) {
      const path = String(event.currentTarget.dataset.path ?? '')
      const row = this.data.fileRows.find((r) => r.path === path)
      if (row === undefined) return
      const canWrite = !this.data.connected && row.kind === 'file' && writableTo(row.path, this.data.sessionId)
      const items = canWrite
        ? ['详情', '重命名', '删除', '复制路径']
        : ['详情', '复制路径']
      wx.showActionSheet({
        itemList: items,
        success: (res) => {
          const picked = items[res.tapIndex]
          if (picked === '详情') this.showDetail(row)
          else if (picked === '重命名') this.askRename(row)
          else if (picked === '删除') this.askDelete(row)
          else if (picked === '复制路径') {
            wx.setClipboardData({ data: row.path })
          }
        },
      })
    },

    showDetail(row: FileRow) {
      const lines = [`路径  ${row.path}`, `类型  ${row.kind === 'dir' ? '目录' : '文件'}`]
      const storeRow = this.data.connected ? undefined : vfsStore.getRow(row.path)
      const size = storeRow?.size_bytes
      if (size !== undefined) lines.push(`大小  ${formatBytes(size)}`)
      const mime = storeRow?.mime ?? row.mime
      if (mime !== undefined && mime.length > 0) lines.push(`MIME  ${mime}`)
      const hash = storeRow?.content_hash
      if (hash !== undefined) lines.push(`SHA256  ${hash.replace(/^sha256:/, '').slice(0, 16)}…`)
      const placement = storeRow?.placement
      if (placement !== undefined) lines.push(`存储  ${placement}`)
      if (storeRow?.updated_ms !== undefined) lines.push(`修改  ${formatRelative(storeRow.updated_ms)}`)
      if (row.syncLabel.length > 0) lines.push(`同步  ${row.syncLabel}`)
      wx.showModal({ title: row.name, content: lines.join('\n'), showCancel: false, confirmText: '关闭' })
    },

    askRename(row: FileRow) {
      wx.showModal({
        title: '重命名',
        editable: true,
        placeholderText: row.name,
        content: row.name,
        success: (res) => {
          if (!res.confirm) return
          const name = (res.content ?? '').trim()
          if (name.length === 0 || name === row.name) return
          if (/[/\\]|\.\./.test(name)) {
            wx.showToast({ title: '文件名不能含 / \\ ..', icon: 'none' })
            return
          }
          const dir = row.path.slice(0, row.path.lastIndexOf('/'))
          const next = `${dir}/${name}`
          this.renameFile(row.path, next)
        },
      })
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

    askDelete(row: FileRow) {
      wx.showModal({
        title: '删除文件',
        content: `确定删除 ${row.name}？此操作不可撤销。`,
        confirmText: '删除',
        confirmColor: '#e5484d',
        success: (res) => {
          if (!res.confirm) return
          try {
            vfs.remove(row.path, { sessionId: this.data.sessionId })
            this.loadLocal(this.data.navPath)
          } catch (e) {
            errorBus.report(e, { op: 'vfs-delete', lane: 'ui', path: row.path })
          }
        },
      })
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
