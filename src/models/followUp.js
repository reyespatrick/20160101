/**
 * Follow-up ("seguimiento") model, aligned with Inmovilla's REST /seguimientos fields.
 * Types (keytiposeg) are agency-specific and come from /enums/?tiposeguimiento.
 */

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function emptyFollowUp() {
  const now = Date.now()
  const remind = new Date(now + 60 * 60_000)
  remind.setMinutes(0, 0, 0)
  return {
    id: newId(),
    remoteId: null, // codseg
    typeKey: null, // keytiposeg
    typeName: '',
    subject: '', // asunto
    description: '', // descrip
    remindAt: remind.getTime(), // fechaaviso
    doneAt: null, // fechafin
    closed: false, // tareacerrada
    propertyCodOfer: null, // keyofe
    propertyLabel: '',
    clientRemoteId: null, // keyprospecto (cod_cli)
    clientLabel: '',
    agentKey: null, // keyagente (optional)
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
}

/** Date → "YYYY-MM-DD HH:mm:ss" in local time (Inmovilla's format). */
export function toInmovillaDate(ts) {
  if (ts === null || ts === undefined || ts === '') return undefined
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return undefined
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** "YYYY-MM-DD HH:mm:ss" (local) → timestamp, or null. */
export function fromInmovillaDate(s) {
  if (!s) return null
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0))
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/** Value for <input type="datetime-local"> */
export function toLocalInput(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
export function fromLocalInput(s) {
  if (!s) return null
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? null : t
}

export function validateFollowUp(f) {
  const errors = {}
  if (!String(f.subject || '').trim()) errors.subject = 'Escribe un asunto'
  if (!f.remindAt) errors.remindAt = 'Indica fecha y hora'
  if (f.closed && !f.doneAt) errors.doneAt = 'Indica cuándo se cerró'
  return errors
}

const DAY = 86_400_000
export function startOfDay(ts = Date.now()) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** overdue | today | upcoming | closed */
export function bucketOf(f, now = Date.now()) {
  if (f.closed) return 'closed'
  const today = startOfDay(now)
  if (f.remindAt < today) return 'overdue'
  if (f.remindAt < today + DAY) return 'today'
  return 'upcoming'
}

export const BUCKETS = [
  { value: 'overdue', label: 'Vencidos', color: '#c0392b' },
  { value: 'today', label: 'Hoy', color: '#f39200' },
  { value: 'upcoming', label: 'Próximos', color: '#2e3192' },
  { value: 'closed', label: 'Cerrados', color: '#6b6e85' },
]

export function formatWhen(ts, now = Date.now()) {
  if (!ts) return ''
  const d = new Date(ts)
  const today = startOfDay(now)
  const day = startOfDay(ts)
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  if (day === today) return `Hoy · ${time}`
  if (day === today + DAY) return `Mañana · ${time}`
  if (day === today - DAY) return `Ayer · ${time}`
  return `${d.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' })} · ${time}`
}

export function matchesFollowUp(f, query) {
  const norm = (s) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
  const q = norm(query).trim()
  if (!q) return true
  const hay = norm([f.subject, f.description, f.typeName, f.propertyLabel, f.clientLabel, f.propertyCodOfer].join(' '))
  return q.split(/\s+/).every((t) => hay.includes(t))
}
