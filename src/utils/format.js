const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export function isRent(p) {
  return Number(p?.keyacci) === 2 || (!Number(p?.precioinmo) && Number(p?.precioalq) > 0)
}

export function priceOf(p) {
  if (!p) return ''
  if (Number(p.aconsultar) === 1) return 'A consultar'
  const rent = isRent(p)
  const value = Number(rent ? p.precioalq : p.precioinmo) || 0
  if (!value) return 'A consultar'
  return rent ? `${eur.format(value)}/mes` : eur.format(value)
}

export function operationLabel(p) {
  return isRent(p) ? 'Alquiler' : 'Venta'
}

export function locationOf(p) {
  return [p?.zona, p?.ciudad].filter((s) => s && String(s).trim()).join(', ')
}

export function surfaceOf(p) {
  const m = Number(p?.m_cons) || Number(p?.m_uties) || 0
  return m ? `${m} m²` : ''
}

export function formatDate(str) {
  if (!str) return ''
  const d = new Date(String(str).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return str
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Photo field may be a full URL or missing; fall back to a neutral placeholder. */
export function photoOf(p) {
  const url = p?.foto || (Array.isArray(p?.fotos) ? p.fotos[0] : '')
  return url && /^https?:\/\//.test(url) ? url : PLACEHOLDER
}

export const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="#e6e7f5"/><path d="M400 180 260 300h40v140h200V300h40z" fill="#2e3192" opacity=".35"/></svg>`,
  )

export const FEATURE_LABELS = {
  ascensor: 'Ascensor',
  terraza: 'Terraza',
  balcon: 'Balcón',
  plaza_gara: 'Garaje',
  parking: 'Parking',
  piscina_com: 'Piscina comunitaria',
  piscina_prop: 'Piscina propia',
  aire_con: 'Aire acondicionado',
  calefaccion: 'Calefacción',
  muebles: 'Amueblado',
  trastero: 'Trastero',
  jardin: 'Jardín',
  vistasalmar: 'Vistas al mar',
  primera_line: 'Primera línea',
  chimenea: 'Chimenea',
  urbanizacion: 'Urbanización',
  mascotas: 'Admite mascotas',
  exclu: 'Exclusiva',
}

export function featuresOf(p) {
  return Object.entries(FEATURE_LABELS)
    .filter(([key]) => Number(p?.[key]) === 1)
    .map(([, label]) => label)
}
