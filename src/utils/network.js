/**
 * Is the connection good enough to make the user wait for a remote lookup?
 *
 * `navigator.connection` only exists on Chromium: no iPhone reports it, so on half the phones in
 * the field the honest answer is "unknown". Unknown is treated as good enough — refusing to try
 * on every iPhone would be worse than a lookup that takes a few seconds — but where the browser
 * does tell us, a 2G link or an explicit data-saver setting is respected.
 */
export function hasFastNetwork() {
  if (typeof navigator === 'undefined') return false
  if (navigator.onLine === false) return false
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  if (!c) return true
  if (c.saveData) return false
  if (!c.effectiveType) return true
  return c.effectiveType === '4g' || c.effectiveType === '5g'
}
