/**
 * Listing created in the app, aligned with Inmovilla's REST /propiedades fields.
 * Type, city, zone, conservation, orientation and publication are Inmovilla enum
 * codes (see stores/enums.js); labels are kept alongside for display offline.
 */

import { t } from '../i18n'
import { DEFAULT_PROVINCE } from '../data/andalucia'

export const OPERATIONS = [
  { value: 1, labelKey: 'common.sale' }, // keyacci
  { value: 2, labelKey: 'common.rent' },
]

export const LISTING_STATUSES = [
  { value: 'draft', labelKey: 'props.statuses.draft', color: '#6b6e85' },
  { value: 'sent', labelKey: 'props.statuses.sent', color: '#2e7d32' },
  { value: 'unavailable', labelKey: 'props.statuses.unavailable', color: '#8e44ad' },
]

/** Inmovilla boolean/numeric extras we expose as checkboxes (field names are Inmovilla's). */
export const FEATURES = [
  ['ascensor', 'props.features.ascensor'],
  ['terraza', 'props.features.terraza'],
  ['balcon', 'props.features.balcon'],
  ['plaza_gara', 'props.features.plaza_gara'],
  ['trastero', 'props.features.trastero'],
  ['piscina_com', 'props.features.piscina_com'],
  ['piscina_prop', 'props.features.piscina_prop'],
  ['aire_con', 'props.features.aire_con'],
  ['calefaccion', 'props.features.calefaccion'],
  ['muebles', 'props.features.muebles'],
  ['jardin', 'props.features.jardin'],
  ['vistasalmar', 'props.features.vistasalmar'],
  ['primera_linea', 'props.features.primera_linea'],
  ['chimenea', 'props.features.chimenea'],
  ['urbanizacion', 'props.features.urbanizacion'],
  ['arma_empo', 'props.features.arma_empo'],
  ['puerta_blin', 'props.features.puerta_blin'],
  ['luminoso', 'props.features.luminoso'],
  ['exclu', 'props.features.exclu'],
]
/** Extras that Inmovilla types as numbers rather than booleans. */
export const NUMERIC_FEATURES = new Set(['plaza_gara'])

export const ENERGY_RATINGS = ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G']

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function emptyProperty() {
  const now = Date.now()
  const features = {}
  for (const [key] of FEATURES) features[key] = false
  return {
    id: newId(),
    ref: '', // Inmovilla identifies the listing by this unique reference
    codOfer: null, // resolved after creation (needed for the ficha link and the owner)
    remoteSnapshot: null, // what Inmovilla held the last time the two sides agreed
    remoteSeenAt: null, // when that was
    remoteChangedAt: '', // Inmovilla's own fechaact, shown so an agent knows what they face
    conflict: null, // { rows, remote, at } — the office moved too; nothing is sent until it is settled
    status: 'draft', // draft | sent | unavailable
    operation: 1, // keyacci
    typeKey: null, // key_tipo
    typeName: '',
    province: DEFAULT_PROVINCE, // Andalusian province code (INE), the Catastro asks for it by name
    cityKey: null, // key_loca — resolved against Inmovilla when the agency knows the town
    cityName: '', // what the agent reads
    cityCatastro: '', // the same town as the Sede Electrónica del Catastro spells it
    zoneKey: null, // key_zona (optional)
    zoneName: '', // free text sent as `zona` when no key_zona
    price: null, // precioinmo
    priceRent: null, // precioalq
    title: '', // tituloes
    description: '', // descripciones
    street: '', // calle
    number: '', // numero
    postalCode: '', // cp
    latitude: null, // kept on the device: Inmovilla's REST fields for coordinates are undocumented
    longitude: null,
    positionAt: null, // when the position was taken — an address read later starts from it
    cadastralRef: '', // referencia catastral, read from the position (Sede Electrónica del Catastro)
    cadastralUrl: '', // the plot on the cadastral map, as the register itself links it
    bedrooms: null, // habitaciones
    bathrooms: null, // banyos
    builtArea: null, // m_cons
    usableArea: null, // m_utiles
    plotArea: null, // m_parcela
    floor: null, // planta
    yearBuilt: null, // antiguedad (year of construction)
    conservation: null, // conservacion enum
    orientation: null, // keyori enum
    energyRating: '', // energialetra
    publish: 0, // eninternet — always "No publicar": nothing is ever published from the phone
    unavailable: false, // nodisponible
    features,
    ownerName: '', // creates a propietario linked to the listing
    ownerSurname: '',
    ownerPhone: '',
    ownerEmail: '',
    ownerRemoteId: null,
    ownerCheckedAt: null, // when Inmovilla was last asked about this phone; null = never got through
    notes: '', // kept on the device only: Inmovilla's property has no private notes field
    photos: [], // [{ id, order, caption }] blobs live in IndexedDB; public URLs are created on sync
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
}

/** Unique-looking reference: prefix + date + 3 random chars. Inmovilla updates by ref, so collisions would overwrite. */
export function suggestRef(prefix = 'APP') {
  const d = new Date()
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const rnd = Math.random().toString(36).slice(2, 5).toUpperCase()
  return `${prefix}-${ymd}-${rnd}`
}

export function titleOf(p) {
  if (p?.title?.trim()) return p.title.trim()
  return [p?.typeName, p?.cityName].filter((s) => s && String(s).trim()).join(' · ') || t('props.form.title')
}

export function locationOf(p) {
  return [p?.zoneName, p?.cityName].filter((s) => s && String(s).trim()).join(', ')
}

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
export function priceOf(p) {
  if (!p) return ''
  if (Number(p.operation) === 2) return p.priceRent ? `${eur.format(p.priceRent)}${t('common.perMonth')}` : t('common.noPrice')
  return p.price ? eur.format(p.price) : t('common.noPrice')
}

export function activeFeatures(p) {
  return FEATURES.filter(([key]) => p?.features?.[key]).map(([, key]) => t(key))
}

export function validateProperty(p) {
  const errors = {}
  if (!String(p.ref || '').trim()) errors.ref = t('props.valid.ref')
  else if (!/^[\w.-]{2,40}$/.test(String(p.ref).trim())) errors.ref = t('props.valid.refFormat')
  if (!p.typeKey) errors.typeKey = t('props.valid.type')
  // Inmovilla refuses POST /propietarios/ without both, so ask for them at the door.
  if (!String(p.ownerPhone || '').replace(/\D/g, '')) errors.ownerPhone = t('props.valid.ownerPhone')
  if (!Number(p.builtArea)) errors.builtArea = t('props.valid.built')
  if (!p.conservation) errors.conservation = t('props.valid.condition')
  if (!String(p.ownerName || '').trim()) errors.ownerName = t('props.valid.ownerName')
  if (!String(p.ownerSurname || '').trim()) errors.ownerSurname = t('props.valid.ownerSurname')
  // The town only has to be named — Inmovilla's key_loca is resolved in the background — and
  // even the name can wait when a position was taken: with no network there is no way to turn
  // coordinates into a town, and refusing to save the listing standing in front of it is how an
  // afternoon of work gets lost. The address is read later, from that same position.
  const positioned = p.latitude != null && p.longitude != null
  if (!String(p.cityName || '').trim() && !positioned) errors.cityName = t('props.valid.city')
  if (Number(p.operation) === 2) {
    if (p.priceRent == null || Number(p.priceRent) <= 0) errors.priceRent = t('props.valid.priceRent')
  } else if (p.price == null || Number(p.price) <= 0) errors.price = t('props.valid.price')
  if (p.yearBuilt != null && (Number(p.yearBuilt) < 1500 || Number(p.yearBuilt) > new Date().getFullYear() + 3)) errors.yearBuilt = t('props.valid.year')
  if (p.postalCode && !/^\d{4,6}$/.test(String(p.postalCode))) errors.postalCode = t('props.valid.cp')
  if (p.ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.ownerEmail)) errors.ownerEmail = t('props.valid.email')
  return errors
}

export function completeness(p) {
  const checks = [
    p.typeKey,
    p.cityName,
    Number(p.operation) === 2 ? p.priceRent : p.price,
    p.bedrooms != null,
    p.bathrooms != null,
    p.builtArea,
    p.description?.trim().length > 40,
    p.photos?.length >= 1,
    p.photos?.length >= 4,
    p.street,
    p.energyRating,
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

export function matchesProperty(p, query) {
  const norm = (s) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  const q = norm(query).trim()
  if (!q) return true
  const hay = norm([p.ref, p.title, p.typeName, p.cityName, p.zoneName, p.street, p.ownerName, p.notes].join(' '))
  return q.split(/\s+/).every((t) => hay.includes(t))
}

export function labelOf(list, value) {
  return list.find((o) => String(o.value) === String(value))?.label || ''
}
