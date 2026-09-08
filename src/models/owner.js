/** Owner ("propietario") model, aligned with Inmovilla's REST /propietarios fields. */
import { digitsOf, looksLikeEmail } from './client'
import { t } from '../i18n'

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `o_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function emptyOwner() {
  const now = Date.now()
  return {
    id: newId(),
    remoteId: null, // cod_cli
    codOfer: null, // listing it is created for (POST requires it)
    name: '',
    surname: '',
    nif: '',
    email: '',
    phone: '', // telefono1
    mobile: '', // telefono2
    phone3: '', // telefono3
    street: '',
    number: '',
    postalCode: '',
    city: '',
    province: '',
    notes: '', // observacion
    properties: [], // [{ codOfer, ref, available }] from Inmovilla
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
}

export function ownerName(o) {
  return [o?.name, o?.surname].filter((s) => s && String(s).trim()).join(' ').trim() || t('common.none')
}

export function validateOwner(o) {
  const errors = {}
  if (!String(o.name || '').trim()) errors.name = t('owner.valid.name')
  if (!o.codOfer && !o.remoteId) errors.codOfer = t('owner.valid.link')
  if (o.email && !looksLikeEmail(o.email)) errors.email = t('owner.valid.email')
  for (const key of ['phone', 'mobile', 'phone3']) if (o[key] && digitsOf(o[key]).length < 6) errors[key] = t('owner.valid.phone')
  if (o.postalCode && !/^\d{4,6}$/.test(String(o.postalCode).trim())) errors.postalCode = t('owner.valid.cp')
  return errors
}
