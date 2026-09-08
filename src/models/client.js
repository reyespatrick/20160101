/**
 * Client (contact) model, aligned with Inmovilla's REST /clientes fields.
 * Inmovilla's client has no pipeline status, budget or search profile, so the
 * app does not invent them: what you see here is what ends up in the CRM.
 */

import { t } from '../i18n'

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function emptyClient() {
  const now = Date.now()
  return {
    id: newId(),
    remoteId: null, // cod_cli in Inmovilla
    name: '',
    surname: '',
    nif: '',
    email: '',
    mobile: '', // telefono2
    phone: '', // telefono1
    street: '',
    number: '',
    postalCode: '',
    city: '',
    province: '',
    notes: '', // observacion
    agentName: '',
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
}

export function fullName(c) {
  return [c?.name, c?.surname].filter((s) => s && String(s).trim()).join(' ').trim() || t('common.none')
}

export function initials(c) {
  const parts = fullName(c).split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?'
}

export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function digitsOf(s) {
  return String(s ?? '').replace(/\D/g, '')
}

/** "+34 600 12 34 56" → { prefix: 34, number: 600123456 }; "600123456" → { prefix: null, number: 600123456 } */
export function splitPhone(s) {
  const raw = String(s ?? '').trim()
  if (!raw) return { prefix: null, number: null }
  let digits = digitsOf(raw)
  let prefix = null
  if (raw.startsWith('+') || digits.startsWith('00')) {
    if (digits.startsWith('00')) digits = digits.slice(2)
    // Spanish numbers are 9 digits; anything longer carries a country prefix
    if (digits.length > 9) {
      prefix = Number(digits.slice(0, digits.length - 9))
      digits = digits.slice(-9)
    }
  }
  return { prefix, number: digits ? Number(digits) : null }
}

export function looksLikePhone(q) {
  return digitsOf(q).length >= 6 && /^[\d\s()+.-]+$/.test(String(q).trim())
}
export function looksLikeEmail(q) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(q).trim())
}

export function searchIndex(c) {
  return normalizeText([c.name, c.surname, c.nif, c.email, c.city, c.province, c.notes, c.agentName].join(' '))
}

/** Match every whitespace-separated term; digit terms also match the phones with separators removed. */
export function matchesClient(c, query) {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const haystack = searchIndex(c)
  const phones = digitsOf(c.mobile) + ' ' + digitsOf(c.phone)
  return terms.every((t) => haystack.includes(t) || (/^\d+$/.test(t) && phones.includes(t)))
}

export function validateClient(c) {
  const errors = {}
  if (!String(c.name || '').trim()) errors.name = t('clients.valid.name')
  if (c.email && !looksLikeEmail(c.email)) errors.email = t('clients.valid.email')
  for (const key of ['mobile', 'phone']) {
    if (c[key] && digitsOf(c[key]).length < 6) errors[key] = t('clients.valid.phone')
  }
  if (c.postalCode && !/^\d{4,6}$/.test(String(c.postalCode).trim())) errors.postalCode = t('clients.valid.cp')
  return errors
}

export function primaryPhone(c) {
  return c?.mobile || c?.phone || ''
}

export function whatsappLink(phone) {
  const { prefix, number } = splitPhone(phone)
  if (!number) return ''
  return `https://wa.me/${prefix || 34}${number}`
}
