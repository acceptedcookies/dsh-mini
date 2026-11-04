/** Trailing-edge throttle used to batch streaming deltas before setData. */
export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Args | undefined

  return (...args: Args): void => {
    pending = args
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      const next = pending
      pending = undefined
      if (next !== undefined) fn(...next)
    }, waitMs)
  }
}
