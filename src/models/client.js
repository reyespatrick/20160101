/** Client (contact) model shared by the UI, the local database and the sync layer. */

export const CLIENT_TYPES = [
  { value: 'buyer', label: 'Comprador' },
  { value: 'tenant', label: 'Inquilino' },
  { value: 'seller', label: 'Vendedor' },
  { value: 'landlord', label: 'Propietario' },
  { value: 'other', label: 'Otro' },
]

export const CLIENT_STATUSES = [
  { value: 'new', label: 'Nuevo', color: '#2e3192' },
  { value: 'contacted', label: 'Contactado', color: '#0e7c86' },
  { value: 'visiting', label: 'Visitando', color: '#f39200' },
  { value: 'negotiating', label: 'Negociando', color: '#8e44ad' },
  { value: 'closed', label: 'Cerrado', color: '#2e7d32' },
  { value: 'lost', label: 'Perdido', color: '#6b6e85' },
]

export const OPERATIONS = [
  { value: '', label: 'Sin especificar' },
  { value: 'buy', label: 'Comprar' },
  { value: 'rent', label: 'Alquilar' },
  { value: 'sell', label: 'Vender' },
  { value: 'let', label: 'Poner en alquiler' },
]

export function labelOf(list, value) {
  return list.find((o) => o.value === value)?.label || ''
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function emptyClient() {
  const now = Date.now()
  return {
    id: newId(),
    name: '',
    surname: '',
    phone: '',
    email: '',
    type: 'buyer',
    status: 'new',
    operation: '',
    propertyTypes: [],
    zones: [],
    budgetMin: null,
    budgetMax: null,
    bedrooms: null,
    notes: '',
    properties: [],
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
}

export function fullName(c) {
  return [c?.name, c?.surname].filter((s) => s && String(s).trim()).join(' ').trim() || 'Sin nombre'
}

export function initials(c) {
  const parts = fullName(c).split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?'
}

/** Lowercase, accent-free text used for searching. */
export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function searchIndex(c) {
  return normalizeText(
    [c.name, c.surname, c.phone, c.email, c.notes, ...(c.zones || []), labelOf(CLIENT_TYPES, c.type), labelOf(CLIENT_STATUSES, c.status)].join(' '),
  )
}

/** Match every whitespace-separated term; digits also match the phone with separators removed. */
export function matchesClient(c, query) {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const haystack = searchIndex(c)
  const phoneDigits = String(c.phone || '').replace(/\D/g, '')
  return terms.every((t) => haystack.includes(t) || (/^\d+$/.test(t) && phoneDigits.includes(t)))
}

export function validateClient(c) {
  const errors = {}
  if (!String(c.name || '').trim()) errors.name = 'El nombre es obligatorio'
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errors.email = 'Email no válido'
  if (c.budgetMin != null && c.budgetMax != null && Number(c.budgetMin) > Number(c.budgetMax)) {
    errors.budgetMax = 'El máximo debe ser mayor que el mínimo'
  }
  return errors
}

export function whatsappLink(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  const intl = digits.length === 9 ? `34${digits}` : digits
  return `https://wa.me/${intl}`
}
