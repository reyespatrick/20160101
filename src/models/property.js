/** Locally created property listing ("alta") model. Field names map onto Inmovilla's ficha. */

export const OPERATIONS = [
  { value: 'sale', label: 'Venta' },
  { value: 'rent', label: 'Alquiler' },
]

export const LISTING_STATUSES = [
  { value: 'draft', label: 'Borrador', color: '#6b6e85' },
  { value: 'ready', label: 'Lista para publicar', color: '#f39200' },
  { value: 'published', label: 'Publicada', color: '#2e7d32' },
  { value: 'archived', label: 'Archivada', color: '#8e44ad' },
]

export const PROPERTY_TYPES = ['Piso', 'Apartamento', 'Ático', 'Dúplex', 'Estudio', 'Chalet', 'Adosado', 'Casa', 'Local comercial', 'Oficina', 'Garaje', 'Parcela', 'Nave']

export const CONDITIONS = [
  { value: '', label: 'Sin especificar' },
  { value: 'new', label: 'Obra nueva' },
  { value: 'good', label: 'Buen estado' },
  { value: 'renovate', label: 'A reformar' },
  { value: 'renovated', label: 'Reformado' },
]

export const ENERGY_RATINGS = ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G']

export const ORIENTATIONS = ['', 'Norte', 'Sur', 'Este', 'Oeste', 'Noreste', 'Noroeste', 'Sureste', 'Suroeste']

export const FEATURES = [
  ['ascensor', 'Ascensor'],
  ['terraza', 'Terraza'],
  ['balcon', 'Balcón'],
  ['plaza_gara', 'Garaje'],
  ['trastero', 'Trastero'],
  ['piscina_com', 'Piscina comunitaria'],
  ['piscina_prop', 'Piscina propia'],
  ['aire_con', 'Aire acondicionado'],
  ['calefaccion', 'Calefacción'],
  ['muebles', 'Amueblado'],
  ['jardin', 'Jardín'],
  ['vistasalmar', 'Vistas al mar'],
  ['primera_line', 'Primera línea'],
  ['chimenea', 'Chimenea'],
  ['urbanizacion', 'Urbanización'],
  ['exclu', 'Exclusiva'],
]

export function labelOf(list, value) {
  return list.find((o) => o.value === value)?.label || ''
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function emptyProperty() {
  const now = Date.now()
  const features = {}
  for (const [key] of FEATURES) features[key] = 0
  return {
    id: newId(),
    ref: '',
    status: 'draft',
    operation: 'sale',
    type: 'Piso',
    price: null,
    priceRent: null,
    title: '',
    description: '',
    address: '',
    city: '',
    zone: '',
    province: '',
    postalCode: '',
    bedrooms: null,
    bathrooms: null,
    builtArea: null,
    usableArea: null,
    plotArea: null,
    floor: '',
    yearBuilt: null,
    condition: '',
    energyRating: '',
    orientation: '',
    features,
    ownerName: '',
    ownerPhone: '',
    notes: '',
    photos: [], // [{ id, order, caption }]
    tags: [],
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
}

export function suggestRef(existing = []) {
  const nums = existing.map((p) => Number(String(p.ref || '').replace(/\D/g, ''))).filter((n) => Number.isFinite(n) && n > 0)
  const next = (nums.length ? Math.max(...nums) : 0) + 1
  return `ALMA-${String(next).padStart(4, '0')}`
}

export function titleOf(p) {
  if (p?.title?.trim()) return p.title.trim()
  return [p?.type, p?.city].filter((s) => s && String(s).trim()).join(' en ') || 'Nueva propiedad'
}

export function locationOf(p) {
  return [p?.zone, p?.city].filter((s) => s && String(s).trim()).join(', ')
}

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
export function priceOf(p) {
  if (!p) return ''
  if (p.operation === 'rent') return p.priceRent ? `${eur.format(p.priceRent)}/mes` : 'Sin precio'
  return p.price ? eur.format(p.price) : 'Sin precio'
}

export function activeFeatures(p) {
  return FEATURES.filter(([key]) => Number(p?.features?.[key]) === 1).map(([, label]) => label)
}

export function validateProperty(p) {
  const errors = {}
  if (!String(p.type || '').trim()) errors.type = 'Elige el tipo de inmueble'
  if (!String(p.city || '').trim()) errors.city = 'La ciudad es obligatoria'
  if (p.operation === 'rent') {
    if (p.priceRent == null || Number(p.priceRent) <= 0) errors.priceRent = 'Indica el precio del alquiler'
  } else if (p.price == null || Number(p.price) <= 0) errors.price = 'Indica el precio de venta'
  if (p.builtArea != null && Number(p.builtArea) < 0) errors.builtArea = 'Superficie no válida'
  if (p.yearBuilt != null && (Number(p.yearBuilt) < 1500 || Number(p.yearBuilt) > new Date().getFullYear() + 3)) errors.yearBuilt = 'Año no válido'
  if (p.postalCode && !/^\d{4,6}$/.test(String(p.postalCode))) errors.postalCode = 'Código postal no válido'
  return errors
}

/** Rough completeness score to nudge the user (0-100). */
export function completeness(p) {
  const checks = [
    p.type,
    p.city,
    p.operation === 'rent' ? p.priceRent : p.price,
    p.bedrooms != null,
    p.bathrooms != null,
    p.builtArea,
    p.description?.trim().length > 40,
    p.photos?.length >= 1,
    p.photos?.length >= 4,
    p.address,
    p.energyRating,
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

/** Text search across the main fields (accent-insensitive). */
export function matchesProperty(p, query) {
  const q = String(query || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
  if (!q) return true
  const hay = [p.ref, p.title, p.type, p.city, p.zone, p.address, p.ownerName, p.notes]
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  return q.split(/\s+/).every((t) => hay.includes(t))
}
