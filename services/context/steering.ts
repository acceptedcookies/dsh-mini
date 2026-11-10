/** steering 只接受三字段或 null。畸形抛错，不吞成 null。 */

export interface SteeringUnit {
  unit_id: string
  unit_digest: string
  content: string
}

export function decodeSteering(raw: unknown): SteeringUnit | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('malformed steering')
  const row = raw as Record<string, unknown>
  if (typeof row.unit_id !== 'string' || typeof row.unit_digest !== 'string' || typeof row.content !== 'string') {
    throw new Error('malformed steering')
  }
  return { unit_id: row.unit_id, unit_digest: row.unit_digest, content: row.content }
}
