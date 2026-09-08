/**
 * Session token holder shared by every API module (set by the auth store).
 * Kept out of the store to avoid circular imports.
 */
let token = ''
let onUnauthorized = null

export function setSessionToken(value) {
  token = value || ''
}
export function getSessionToken() {
  return token
}
export function authHeader() {
  return token ? { Authorization: `Bearer ${token}` } : {}
}
/** Called by API modules when the server says the session is gone (401 with code "session"). */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn
}
export function reportUnauthorized(err) {
  if (err?.code === 'session' && onUnauthorized) onUnauthorized(err)
}
