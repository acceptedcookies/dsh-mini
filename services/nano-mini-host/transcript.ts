/**
 * transcript —— session 聊天记录 → POD1 vfs 键区上行 + 本地 durable 指针（G5）。
 * 远端键（vfs/ 内相对）：transcripts/{sid}/{seq:06d}.json 每 ChatItem 一行，
 *   transcripts/{sid}/_meta.json 会话元（item_count/last_seq/model/updated_ms）。
 * 本地 durable 指针（wx.storage，小程序本地 durable 面）：
 *   dsh:mini:session-ptr:{sid} → {remote_prefix, last_seq, item_count, etag?, updated_ms}
 * 指针是消费回执不是真源——远端行是真源，指针只记上行水位。
 */
import { vfsRemoteFor } from '../state/provider'
import { hasFreshTicket } from '../fx/ticket'
import { encodeUtf8, decodeUtf8 } from '../fx/utf8'
import type { ChatItem } from '../../types/protocol'

const PTR_PREFIX = 'dsh:mini:session-ptr:'

export interface SessionPointer {
  remote_prefix: string
  last_seq: number
  item_count: number
  updated_ms: number
}

export function readSessionPointer(sessionId: string): SessionPointer | undefined {
  const v = wx.getStorageSync(`${PTR_PREFIX}${sessionId}`) as SessionPointer | '' | undefined
  return v !== '' && v !== undefined ? v : undefined
}

function writeSessionPointer(sessionId: string, p: SessionPointer): void {
  wx.setStorageSync(`${PTR_PREFIX}${sessionId}`, p)
}

const seqKey = (sid: string, seq: number): string =>
  `transcripts/${sid}/${String(seq).padStart(6, '0')}.json`

const enc = (s: string): ArrayBuffer => {
  const u8 = encodeUtf8(s)
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

export interface TranscriptSyncReport {
  pushed: number
  skipped: number
  lastSeq: number
}

/**
 * 增量上行：本地指针水位之后的 ChatItem 逐行推远端；远端行不可变（按 seq 幂等）。
 * remote lane 缺位 → 返回 null（调用方按 null 降级，不伪造上行）。
 */
export async function syncTranscript(sessionId: string, items: ChatItem[], meta: { model?: string } = {}): Promise<TranscriptSyncReport | null> {
  const remote = vfsRemoteFor()
  if (remote === null) return null
  const ptr = readSessionPointer(sessionId)
  const watermark = ptr?.last_seq ?? -1
  let pushed = 0
  let skipped = 0
  let lastSeq = watermark
  for (const item of items) {
    if (item.seq <= watermark) { skipped += 1; continue }
    await remote.put(seqKey(sessionId, item.seq), enc(JSON.stringify(item)), { mime: 'application/json' })
    pushed += 1
    lastSeq = item.seq
  }
  if (lastSeq > watermark || ptr === undefined) {
    await remote.put(`transcripts/${sessionId}/_meta.json`, enc(JSON.stringify({
      session_id: sessionId, item_count: items.length, last_seq: lastSeq,
      model: meta.model ?? 'unknown', updated_ms: Date.now(),
    })), { mime: 'application/json' })
    writeSessionPointer(sessionId, {
      remote_prefix: `transcripts/${sessionId}/`,
      last_seq: lastSeq, item_count: items.length, updated_ms: Date.now(),
    })
  }
  return { pushed, skipped, lastSeq }
}

const dec = (b: ArrayBuffer): string => decodeUtf8(new Uint8Array(b))

/**
 * GSTH-like 异设备重建面：远端 transcripts/{sid}/* 行 → ChatItem[]（seq 升序）。
 * remote lane 缺位/无前缀 → null（调用方按 null 降级）。坏行跳过（如实计数）。
 */
export async function pullTranscript(sessionId: string): Promise<{ items: ChatItem[]; skipped: number } | null> {
  const remote = vfsRemoteFor()
  if (remote === null) return null
  const keys = (await remote.list(`transcripts/${sessionId}/`, 1000))
    .filter((k) => /\/\d{6}\.json$/.test(k)).sort()
  if (keys.length === 0) return null
  const items: ChatItem[] = []
  let skipped = 0
  for (const k of keys) {
    const r = await remote.get(k)
    if (r === null) continue
    try {
      items.push(JSON.parse(dec(r.bytes)) as ChatItem)
    } catch {
      skipped += 1
    }
  }
  return { items, skipped }
}

/** 会话删除的远端面：transcript 行 + _meta + 本地指针清理（best-effort，
 *  行删失败 warn 不阻塞本地删除——行是 owner 私域，残留仅占用不计语义）。 */
export async function dropTranscript(sessionId: string): Promise<void> {
  wx.removeStorageSync(`${PTR_PREFIX}${sessionId}`)
  // 无活票据不碰远端（铸票=SOTER 须手势上下文）——远端行残留按 best-effort 登记语义。
  if (!hasFreshTicket()) return
  const remote = vfsRemoteFor()
  if (remote === null) return
  try {
    const keys = await remote.list(`transcripts/${sessionId}/`, 1000)
    for (const k of keys) await remote.del(k)
  } catch (e) {
    console.warn(`[transcript] drop ${sessionId} 远端行清理失败:`, e instanceof Error ? e.message : e)
  }
}
