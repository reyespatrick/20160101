/**
 * Minimal Supabase client for Cloudflare Workers: PostgREST and Storage over plain fetch.
 *
 * No SDK on purpose — the surface we need is small, and a dependency-free module keeps the
 * Worker bundle tiny and avoids version drift. It always authenticates with the secret
 * (service role) key, which bypasses row level security, so this module must only ever run
 * server side: the key lives in the Pages Function secrets and never reaches the browser.
 */
const RANGE = /\/(\d+)$/

function fail(message, status, body) {
  return Object.assign(new Error(message), { status, details: body?.details, code: body?.code })
}

export function createSupabase(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '')
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('SUPABASE_URL is not configured')
  if (!key) throw new Error('SUPABASE_SECRET_KEY is not configured')

  const headers = (extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, ...extra })

  /** `{ id: 'x' }` → `id=eq.x`; values are encoded, so no filter injection through ids. */
  const filters = (eq = {}) =>
    Object.entries(eq)
      .map(([column, value]) => `${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`)
      .join('&')

  async function rest(path, { method = 'GET', body, prefer, range } = {}) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: headers({
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(prefer ? { Prefer: prefer } : {}),
        ...(range ? { Range: range } : {}),
      }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let parsed
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    if (!res.ok) throw fail(parsed?.message || `Supabase responded ${res.status}`, res.status, parsed)
    return { data: parsed, contentRange: res.headers.get('content-range') }
  }

  return {
    /** Rows matching `eq`; `single` returns the first row or null. */
    async select(table, { eq, columns = '*', order, limit, single = false } = {}) {
      const query = [filters(eq), `select=${encodeURIComponent(columns)}`, order && `order=${encodeURIComponent(order)}`, (single ? 1 : limit) && `limit=${single ? 1 : limit}`]
        .filter(Boolean)
        .join('&')
      const { data } = await rest(`${table}?${query}`)
      const rows = Array.isArray(data) ? data : []
      return single ? rows[0] || null : rows
    },

    async count(table, { eq } = {}) {
      const query = [filters(eq), 'select=*'].filter(Boolean).join('&')
      const { contentRange } = await rest(`${table}?${query}`, { prefer: 'count=exact', range: '0-0' })
      const total = RANGE.exec(contentRange || '')
      return total ? Number(total[1]) : 0
    },

    async insert(table, row) {
      const { data } = await rest(table, { method: 'POST', body: row, prefer: 'return=representation' })
      return Array.isArray(data) ? data[0] : data
    },

    async update(table, eq, patch) {
      const { data } = await rest(`${table}?${filters(eq)}`, { method: 'PATCH', body: patch, prefer: 'return=representation' })
      return Array.isArray(data) ? data[0] || null : data
    },

    async remove(table, eq) {
      await rest(`${table}?${filters(eq)}`, { method: 'DELETE' })
    },

    storage: {
      /** Uploads and returns the public URL Inmovilla will download the photo from. */
      async upload(bucket, path, body, contentType) {
        const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
          method: 'POST',
          headers: headers({ 'Content-Type': contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' }),
          body,
        })
        if (!res.ok) throw fail(`Storage upload failed (${res.status})`, res.status, await res.json().catch(() => null))
        return `${url}/storage/v1/object/public/${bucket}/${path}`
      },
      async remove(bucket, paths) {
        const res = await fetch(`${url}/storage/v1/object/${bucket}`, {
          method: 'DELETE',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ prefixes: paths }),
        })
        if (!res.ok) throw fail(`Storage delete failed (${res.status})`, res.status, null)
      },
      async list(bucket, prefix = '', limit = 100) {
        const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ prefix, limit }),
        })
        if (!res.ok) throw fail(`Storage list failed (${res.status})`, res.status, null)
        return res.json()
      },
    },

    auth: {
      /** Creates a confirmed account. Admin endpoint: needs the secret key, never the browser. */
      async createUser({ email, password, metadata }) {
        const res = await fetch(`${url}/auth/v1/admin/users`, {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ email: String(email).trim().toLowerCase(), password, email_confirm: true, user_metadata: metadata || {} }),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok) throw fail(body?.msg || body?.message || `Auth responded ${res.status}`, res.status, body)
        return body
      },
      async deleteUser(id) {
        const res = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: headers() })
        if (!res.ok && res.status !== 404) throw fail(`Auth delete failed (${res.status})`, res.status, null)
      },
      async updateUser(id, patch) {
        const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
          method: 'PUT',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(patch),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok) throw fail(body?.msg || `Auth update failed (${res.status})`, res.status, body)
        return body
      },
      /** Exchanges email + password for a session, exactly as the browser client would. */
      async signInWithPassword({ email, password }) {
        const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY || key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: String(email).trim().toLowerCase(), password }),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok) throw fail(body?.error_description || body?.msg || 'Email o contraseña incorrectos', res.status === 400 ? 401 : res.status, body)
        return body
      },
    },

    /** Verifies a user's access token with Supabase Auth and returns the auth user, or null. */
    async userFromToken(accessToken) {
      if (!accessToken) return null
      const res = await fetch(`${url}/auth/v1/user`, { headers: headers({ Authorization: `Bearer ${accessToken}` }) })
      if (res.status === 401 || res.status === 403) return null
      if (!res.ok) throw fail(`Supabase Auth responded ${res.status}`, res.status, null)
      const user = await res.json()
      return user?.id ? user : null
    },
  }
}
