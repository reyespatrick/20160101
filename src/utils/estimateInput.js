/**
 * Builds the normalised property sent to /api/estimate, from either an Inmovilla
 * ficha (apiweb fields) or a listing created in the app (models/property.js).
 */
import { FEATURES } from '../models/property'
import { FEATURE_LABELS, isRent } from './format'

const currentYear = () => new Date().getFullYear()

export function inputFromFicha(d) {
  const rent = isRent(d)
  const description = Array.isArray(d.descripciones) ? d.descripciones.filter(Boolean).join('\n') : d.descripciones || d.descrip || ''
  return {
    source: 'inmovilla',
    key: `inmovilla:${d.cod_ofer}`,
    codOfer: Number(d.cod_ofer) || null,
    ref: d.ref || '',
    operation: rent ? 2 : 1,
    typeKey: Number(d.key_tipo) || null,
    type: d.nbtipo || '',
    price: Number(rent ? d.precioalq : d.precioinmo) || null,
    city: d.ciudad || '',
    zone: d.zona || '',
    province: d.provincia || '',
    postalCode: d.cp || '',
    bedrooms: Number(d.habitaciones) || null,
    bathrooms: Number(d.banyos) || null,
    builtArea: Number(d.m_cons) || null,
    usableArea: Number(d.m_uties) || null,
    plotArea: Number(d.m_parcela) || null,
    floor: d.planta ?? '',
    age: Number(d.antiguedad) || null,
    condition: d.nbconservacion || '',
    orientation: d.nborientacion || '',
    energy: d.energialetra || '',
    features: Object.keys(FEATURE_LABELS).filter((k) => Number(d[k]) === 1),
    description,
  }
}

export function inputFromLocal(p, enums) {
  const rent = Number(p.operation) === 2
  return {
    source: 'local',
    key: `local:${p.id}`,
    codOfer: p.codOfer ? Number(p.codOfer) : null,
    ref: p.ref || '',
    operation: rent ? 2 : 1,
    typeKey: p.typeKey ? Number(p.typeKey) : null,
    type: p.typeName || '',
    price: Number(rent ? p.priceRent : p.price) || null,
    city: p.cityName || '',
    zone: p.zoneName || '',
    province: '',
    postalCode: p.postalCode || '',
    bedrooms: Number(p.bedrooms) || null,
    bathrooms: Number(p.bathrooms) || null,
    builtArea: Number(p.builtArea) || null,
    usableArea: Number(p.usableArea) || null,
    plotArea: Number(p.plotArea) || null,
    floor: p.floor ?? '',
    yearBuilt: Number(p.yearBuilt) || null,
    age: Number(p.yearBuilt) ? currentYear() - Number(p.yearBuilt) : null,
    condition: enums?.label('conservacion', p.conservation) || '',
    orientation: enums?.label('keyori', p.orientation) || '',
    energy: p.energyRating || '',
    features: FEATURES.filter(([k]) => p.features?.[k]).map(([k]) => k),
    description: [p.title, p.description].filter(Boolean).join('\n'),
  }
}
