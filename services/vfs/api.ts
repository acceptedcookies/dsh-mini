/** services/vfs barrel —— 五根 VFS（rules/filesystem.md 落地）。
 * 注意：小程序编译链对 `export { x } from '...'` 再导出产出不可注册模块（静默吞错），
 * 必须用 import + export 两段式；类型请从叶文件直取。
 */
import { vfs, guessMime } from './vfs'
import { vfsReadView, READ_VIEW_BOUNDS, READ_VIEW_ALGORITHM } from './read-view'
import { vfsStore } from './store'
import { resolveVfsPath, sessionCwd, assertWritable, VfsError, VFS_LANE_ROOTS, VFS_READ_ONLY_PREFIXES } from './paths'
import { vfsJournal } from './journal'
import { localObjects, S3ObjectBackend, backendFor } from './objects'

export {
  vfs,
  guessMime,
  vfsReadView,
  READ_VIEW_BOUNDS,
  READ_VIEW_ALGORITHM,
  vfsStore,
  resolveVfsPath,
  sessionCwd,
  assertWritable,
  VfsError,
  VFS_LANE_ROOTS,
  VFS_READ_ONLY_PREFIXES,
  vfsJournal,
  localObjects,
  S3ObjectBackend,
  backendFor,
}
