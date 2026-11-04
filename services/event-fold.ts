import type { ChatItem } from '../types/protocol'

/** Insert or replace one item, keeping the list sorted by durable sequence. */
export function upsertItem(items: ChatItem[], item: ChatItem): ChatItem[] {
  const index = items.findIndex((candidate) => candidate.id === item.id)
  if (index === -1) {
    return [...items, item].sort((left, right) => left.seq - right.seq)
  }
  const next = [...items]
  next[index] = item
  return next.sort((left, right) => left.seq - right.seq)
}

/** Merge a snapshot window with already loaded items without duplicating ids. */
export function mergeItems(current: ChatItem[], incoming: ChatItem[]): ChatItem[] {
  let next = current
  for (const item of incoming) next = upsertItem(next, item)
  return next
}

export function removeItem(items: ChatItem[], id: string): ChatItem[] {
  return items.filter((item) => item.id !== id)
}

export function lastSeq(items: ChatItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.seq), 0)
}
