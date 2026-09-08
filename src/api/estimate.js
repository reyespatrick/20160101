/** Valuation with Claude, through the relay (the Anthropic key stays on the server). */
import { ApiError } from './inmovilla'
import { authHeader, reportUnauthorized } from './session'

export async function requestEstimate(property, locale) {
  let res
  try {
    res = await fetch('/api/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
      body: JSON.stringify({ property, locale }),
    })
  } catch {
    throw new ApiError('No hay conexión con el servidor', 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = Object.assign(new ApiError(data.error || `Error ${res.status}`, res.status), { code: data.code })
    reportUnauthorized(err)
    throw err
  }
  return data
}
