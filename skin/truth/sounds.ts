/** MS01 真源 · sounds 族（8 事件键；服务落地后迁回自然真源，T-O-3 登记） */
import type { SoundEntry } from './_shared'

export const SOUND_ENTRIES: SoundEntry[] = [
  { key: 'message.send', event: 'message.send' },
  { key: 'message.receive', event: 'message.receive' },
  { key: 'turn.complete', event: 'turn.complete' },
  { key: 'turn.error', event: 'turn.error' },
  { key: 'composer.attach', event: 'composer.attach' },
  { key: 'session.new', event: 'session.new' },
  { key: 'session.delete', event: 'session.delete' },
  { key: 'ui.tap', event: 'ui.tap' },
]
