import { intlLocale, t } from '../i18n'

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

/**
 * How many bedrooms a listing has, as Inmovilla actually records them.
 *
 * It keeps two counts: `habitaciones` for single rooms and `habdobles` for doubles. A real
 * two-bedroom flat can therefore have `habitaciones: 0` and `habdobles: 2` — and the app, reading
 * only the first, showed it with no bedroom at all, on the card and on the ficha. Seen on a live
 * listing (AR2.1, 11 Sept 2026).
 */
export function bedroomsOf(p) {
  return (Number(p?.habitaciones) || 0) + (Number(p?.habdobles) || 0)
}

export function isRent(p) {
  return Number(p?.keyacci) === 2 || (!Number(p?.precioinmo) && Number(p?.precioalq) > 0)
}

export function priceOf(p) {
  if (!p) return ''
  if (Number(p.aconsultar) === 1) return t('common.askPrice')
  const rent = isRent(p)
  const value = Number(rent ? p.precioalq : p.precioinmo) || 0
  if (!value) return t('common.askPrice')
  return rent ? `${eur.format(value)}${t('common.perMonth')}` : eur.format(value)
}

export function operationLabel(p) {
  return isRent(p) ? t('common.rent') : t('common.sale')
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
  return d.toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Photo field may be a full URL or missing; fall back to a neutral placeholder. */
export function photoOf(p) {
  const url = p?.foto || (Array.isArray(p?.fotos) ? p.fotos[0] : '')
  return url && /^(https?:\/\/|\/)/.test(url) ? url : PLACEHOLDER
}

export const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="#e6e7f5"/><path d="M400 180 260 300h40v140h200V300h40z" fill="#2e3192" opacity=".35"/></svg>`,
  )

export const FEATURE_LABELS = {
  ascensor: 'props.features.ascensor',
  terraza: 'props.features.terraza',
  balcon: 'props.features.balcon',
  plaza_gara: 'props.features.plaza_gara',
  parking: 'props.features.parking',
  piscina_com: 'props.features.piscina_com',
  piscina_prop: 'props.features.piscina_prop',
  aire_con: 'props.features.aire_con',
  calefaccion: 'props.features.calefaccion',
  muebles: 'props.features.muebles',
  trastero: 'props.features.trastero',
  jardin: 'props.features.jardin',
  vistasalmar: 'props.features.vistasalmar',
  primera_line: 'props.features.primera_line',
  chimenea: 'props.features.chimenea',
  urbanizacion: 'props.features.urbanizacion',
  mascotas: 'props.features.mascotas',
  exclu: 'props.features.exclu',
}

export function featuresOf(p) {
  return Object.entries(FEATURE_LABELS)
    .filter(([key]) => Number(p?.[key]) === 1)
    .map(([, key]) => t(key))
}
