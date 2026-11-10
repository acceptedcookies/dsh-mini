/**
 * 本地 producer。本阶段接身份三字段，并接受已经是 canonical 的对象。
 * 不构造 LocalEvent；物化只发生在 derive。
 */

import { projectCanonical } from '../project'
import type { CanonicalEvent, ToCanonical } from '../types'

export const toCanonical: ToCanonical = (input: unknown): CanonicalEvent => {
  return projectCanonical(input)
}
