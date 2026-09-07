/**
 * Thin client for Inmovilla's REST API v1 (https://procesos.inmovilla.com/api/v1).
 * Every request carries the agency token in the `Token` header and JSON bodies.
 *
 * With `dryRun` (or no token) nothing leaves the server: calls return fake ids so
 * the whole pipeline can be exercised locally.
 */
import { DEFAULT_PATHS, extractRemoteId, toInmovillaClient, toInmovillaProperty } from './inmovillaMapping.js'

export class InmovillaRestError extends Error {
  constructor(message, status, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

export class InmovillaRest {
  constructor({ baseUrl, token, paths = DEFAULT_PATHS, dryRun = false, timeoutMs = 20_000, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl || 'https://procesos.inmovilla.com/api/v1').replace(/\/+$/, '')
    this.token = token || ''
    this.paths = { ...DEFAULT_PATHS, ...paths }
    this.dryRun = dryRun || !this.token
    this.timeoutMs = timeoutMs
    this.fetch = fetchImpl
  }

  get enabled() {
    return Boolean(this.token) || this.dryRun
  }

  describe() {
    return this.dryRun ? 'dry-run (no token configured, nothing is sent to Inmovilla)' : this.baseUrl
  }

  async request(method, path, { json, body, contentType } = {}) {
    if (this.dryRun) return { ok: true, status: 200, body: { id: `dry-${Date.now().toString(36)}` } }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetch(this.baseUrl + path, {
        method,
        headers: {
          Token: this.token,
          Accept: 'application/json',
          'Content-Type': contentType || (json !== undefined ? 'application/json' : 'application/octet-stream'),
        },
        body: json !== undefined ? JSON.stringify(json) : body,
        signal: controller.signal,
      })
      const text = await res.text()
      let parsed
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        parsed = text
      }
      if (!res.ok) throw new InmovillaRestError(`Inmovilla ${res.status}: ${String(text).slice(0, 200)}`, res.status, parsed)
      return { ok: true, status: res.status, body: parsed }
    } catch (err) {
      if (err instanceof InmovillaRestError) throw err
      throw new InmovillaRestError(err.name === 'AbortError' ? 'Inmovilla no responde' : err.message, 0)
    } finally {
      clearTimeout(timer)
    }
  }

  // ---- properties ----
  async createProperty(record) {
    const res = await this.request('POST', this.paths.properties, { json: toInmovillaProperty(record) })
    return extractRemoteId(res.body)
  }
  async updateProperty(remoteId, record) {
    await this.request('PUT', `${this.paths.properties}/${encodeURIComponent(remoteId)}`, { json: toInmovillaProperty(record) })
    return remoteId
  }
  async deleteProperty(remoteId) {
    await this.request('DELETE', `${this.paths.properties}/${encodeURIComponent(remoteId)}`)
  }
  async uploadPhoto(remoteId, buffer, { order = 0, caption = '' } = {}) {
    const path = this.paths.photos.replace('{id}', encodeURIComponent(remoteId))
    // Photo sent as base64 JSON so it travels like the other calls; switch to multipart here if the doc requires it.
    const res = await this.request('POST', path, { json: { orden: order, descripcion: caption, foto: buffer.toString('base64'), formato: 'jpg' } })
    return extractRemoteId(res.body)
  }

  // ---- clients ----
  async createClient(record) {
    const res = await this.request('POST', this.paths.clients, { json: toInmovillaClient(record) })
    return extractRemoteId(res.body)
  }
  async updateClient(remoteId, record) {
    await this.request('PUT', `${this.paths.clients}/${encodeURIComponent(remoteId)}`, { json: toInmovillaClient(record) })
    return remoteId
  }
  async deleteClient(remoteId) {
    await this.request('DELETE', `${this.paths.clients}/${encodeURIComponent(remoteId)}`)
  }
}

export function restFromEnv(env = process.env) {
  return new InmovillaRest({
    baseUrl: env.INMOVILLA_REST_URL,
    token: env.INMOVILLA_REST_TOKEN,
    dryRun: env.INMOVILLA_REST_DRY_RUN === '1' || env.INMOVILLA_MOCK === '1',
  })
}
