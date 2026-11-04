/** Generate a short correlation id without requiring crypto.getRandomValues. */
export function randomId(prefix = 'id'): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}
