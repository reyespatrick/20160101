/**
 * Listing created in the app, aligned with Inmovilla's REST /propiedades fields.
 * Type, city, zone, conservation, orientation and publication are Inmovilla enum
 * codes (see stores/enums.js); labels are kept alongside for display offline.
 */

export const OPERATIONS = [
  { value: 1, label: 'Venta' }, // keyacci
  { value: 2, label: 'Alquiler' },
]

export const LISTING_STATUSES = [
  { value: 'draft', label: 'Borrador', color: '#6b6e85' },
  { value: 'sent', label: 'En Inmovilla', color: '#2e7d32' },
  { value: 'unavailable', label: 'Dada de baja', color: '#8e44ad' },
]

/** Inmovilla boolean/numeric extras we expose as checkboxes (field names are Inmovilla's). */
export const FEATURES = [
  ['ascensor', 'Ascensor'],
  ['terraza', 'Terraza'],
  ['balcon', 'Balcón'],
  ['plaza_gara', 'Plaza de garaje'],
  ['trastero', 'Trastero'],
  ['piscina_com', 'Piscina comunitaria'],
  ['piscina_prop', 'Piscina propia'],
  ['aire_con', 'Aire acondicionado'],
  ['calefaccion', 'Calefacción'],
  ['muebles', 'Amueblado'],
  ['jardin', 'Jardín'],
  ['vistasalmar', 'Vistas al mar'],
  ['primera_linea', 'Primera línea'],
  ['chimenea', 'Chimenea'],
  ['urbanizacion', 'Urbanización'],
  ['arma_empo', 'Armarios empotrados'],
  ['puerta_blin', 'Puerta blindada'],
  ['luminoso', 'Luminoso'],
  ['exclu', 'Exclusiva'],
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
    status: 'draft', // draft | sent | unavailable
    operation: 1, // keyacci
    typeKey: null, // key_tipo
    typeName: '',
    cityKey: null, // key_loca
    cityName: '',
    zoneKey: null, // key_zona (optional)
    zoneName: '', // free text sent as `zona` when no key_zona
    price: null, // precioinmo
    priceRent: null, // precioalq
    title: '', // tituloes
    description: '', // descripciones
    street: '', // calle
    number: '', // numero
    postalCode: '', // cp
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
    publish: null, // eninternet enum
    unavailable: false, // nodisponible
    features,
    ownerName: '', // creates a propietario linked to the listing
    ownerSurname: '',
    ownerPhone: '',
    ownerEmail: '',
    ownerRemoteId: null,
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
  return [p?.typeName, p?.cityName].filter((s) => s && String(s).trim()).join(' en ') || 'Nueva propiedad'
}

export function locationOf(p) {
  return [p?.zoneName, p?.cityName].filter((s) => s && String(s).trim()).join(', ')
}

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
export function priceOf(p) {
  if (!p) return ''
  if (Number(p.operation) === 2) return p.priceRent ? `${eur.format(p.priceRent)}/mes` : 'Sin precio'
  return p.price ? eur.format(p.price) : 'Sin precio'
}

export function activeFeatures(p) {
  return FEATURES.filter(([key]) => p?.features?.[key]).map(([, label]) => label)
}

export function validateProperty(p) {
  const errors = {}
  if (!String(p.ref || '').trim()) errors.ref = 'La referencia es obligatoria'
  else if (!/^[\w.-]{2,40}$/.test(String(p.ref).trim())) errors.ref = 'Solo letras, números, guiones y puntos'
  if (!p.typeKey) errors.typeKey = 'Elige el tipo de inmueble'
  if (!p.cityKey) errors.cityKey = 'Elige la ciudad'
  if (Number(p.operation) === 2) {
    if (p.priceRent == null || Number(p.priceRent) <= 0) errors.priceRent = 'Indica el precio del alquiler'
  } else if (p.price == null || Number(p.price) <= 0) errors.price = 'Indica el precio de venta'
  if (p.yearBuilt != null && (Number(p.yearBuilt) < 1500 || Number(p.yearBuilt) > new Date().getFullYear() + 3)) errors.yearBuilt = 'Año no válido'
  if (p.postalCode && !/^\d{4,6}$/.test(String(p.postalCode))) errors.postalCode = 'Código postal no válido'
  if (p.ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.ownerEmail)) errors.ownerEmail = 'Email no válido'
  return errors
}

export function completeness(p) {
  const checks = [
    p.typeKey,
    p.cityKey,
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
