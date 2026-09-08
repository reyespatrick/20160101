/** Accounts API client (login, profile, agency keys, users). */
import { ApiError } from './inmovilla'
import { authHeader } from './session'

async function request(path, { method = 'GET', json, auth = true } = {}) {
  let res
  try {
    res = await fetch(`/api/account${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(auth ? authHeader() : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    })
  } catch {
    throw new ApiError('Sin conexión con el servidor', 0)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new ApiError(body.error || `Error ${res.status}`, res.status), { code: body.code })
  return body
}

export const accountStatus = () => request('/status', { auth: false })
export const signup = (data) => request('/signup', { method: 'POST', json: data, auth: false })
export const login = (email, password) => request('/login', { method: 'POST', json: { email, password }, auth: false })
export const me = () => request('/me')
export const updateMe = (data) => request('/me', { method: 'PUT', json: data })
export const getAgency = () => request('/agency')
export const updateAgency = (data) => request('/agency', { method: 'PUT', json: data })
export const listUsers = () => request('/users')
export const createUser = (data) => request('/users', { method: 'POST', json: data })
export const updateUser = (id, data) => request(`/users/${id}`, { method: 'PUT', json: data })
export const deleteUser = (id) => request(`/users/${id}`, { method: 'DELETE' })
