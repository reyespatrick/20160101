import { ApiError } from './inmovilla'

async function request(path, { token, method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('Sin conexión con el servidor', 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error || `Error ${res.status}`, res.status)
  return data
}

export async function login(credentials) {
  let res
  try {
    res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    })
  } catch {
    throw new ApiError('No hay conexión con el servidor', 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error || `Error ${res.status}`, res.status)
  return data // { token, expiresAt, agency }
}

/** Push local changes and pull everything changed since `since`. */
export function syncClients(token, { since, changes }) {
  return request('/api/clients/sync', { token, method: 'POST', body: { since, changes } })
}
