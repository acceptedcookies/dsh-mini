/**
 * journal —— mutation fence（nano 同形：pending/finished/unknown）。
 * 小程序单进程串行 → fence 语义免费，但形态保留：
 * 将来 cloud-pinned 行被远端改时，此形态是过期检测的现成挂点。
 */

export type MutationOp = 'write' | 'remove' | 'ingest'
export type MutationStatus = 'pending' | 'finished' | 'unknown'

interface MutationEntry {
  id: number
  path: string
  op: MutationOp
  status: MutationStatus
  at_ms: number
}

const entries: MutationEntry[] = []
let nextId = 1
const RING_MAX = 512

export const vfsJournal = {
  begin(path: string, op: MutationOp): number {
    const id = nextId++
    entries.push({ id, path, op, status: 'pending', at_ms: Date.now() })
    if (entries.length > RING_MAX) entries.splice(0, entries.length - RING_MAX)
    return id
  },
  finish(id: number): void {
    const e = entries.find((x) => x.id === id)
    if (e !== undefined) e.status = 'finished'
  },
  abandon(id: number): void {
    const e = entries.find((x) => x.id === id)
    if (e !== undefined) e.status = 'unknown'
  },
  /** capture fence：pending > 0 时不捕获（写在字节落盘前即应 not-started）。 */
  pendingCount(): number {
    return entries.filter((e) => e.status === 'pending').length
  },
  pending(): Array<{ path: string; op: MutationOp }> {
    return entries.filter((e) => e.status === 'pending').map((e) => ({ path: e.path, op: e.op }))
  },
}
