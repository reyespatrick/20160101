/**
 * Property valuation with Claude.
 *
 *  1. comparables: listings of the same operation + type (same city when enough of them)
 *     fetched through apiweb with the agency's keys;
 *  2. peer statistics (price per m²: median, quartiles, percentile of the asking price);
 *  3. Claude (structured output) turns the property + the peers into an estimate,
 *     a range and a short reasoning, in the user's language.
 *
 * The agency's Anthropic key is stored encrypted next to the Inmovilla keys and only
 * ever used here, server side.
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'

export const MODEL = 'claude-opus-5'
const MAX_PEERS = 60
const MIN_CITY_PEERS = 5

const LANGUAGES = { es: 'Spanish', fr: 'French', en: 'English' }

export const EstimateSchema = z.object({
  estimatedValue: z.number().describe('Most likely market value in euros (monthly rent for rentals)'),
  rangeLow: z.number().describe('Lower bound of the plausible value range, euros'),
  rangeHigh: z.number().describe('Upper bound of the plausible value range, euros'),
  confidence: z.enum(['low', 'medium', 'high']),
  verdict: z.enum(['underpriced', 'fair', 'overpriced']).describe('How the current asking price compares with the estimate'),
  summary: z.string().describe('2-4 sentences explaining the valuation, for the agent'),
  strengths: z.array(z.string()).describe('Short bullet points that push the value up'),
  weaknesses: z.array(z.string()).describe('Short bullet points that push the value down'),
  adjustments: z.array(z.object({ factor: z.string(), impactPct: z.number() })).describe('Main adjustments applied to the peer median, as percentages (negative lowers the value)'),
  suggestedPrice: z.number().describe('Recommended asking price in euros (rounded, marketing-friendly)'),
})

// ---------------------------------------------------------------------------
// Normalised property (what the phone sends) and peers (from apiweb)
// ---------------------------------------------------------------------------
export function normalizeInput(raw = {}) {
  const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))
  return {
    source: raw.source === 'local' ? 'local' : 'inmovilla',
    key: String(raw.key || raw.ref || '').slice(0, 64),
    ref: String(raw.ref || '').slice(0, 64),
    codOfer: num(raw.codOfer),
    operation: Number(raw.operation) === 2 ? 2 : 1,
    typeKey: num(raw.typeKey),
    type: String(raw.type || '').slice(0, 80),
    price: num(raw.price),
    city: String(raw.city || '').slice(0, 120),
    zone: String(raw.zone || '').slice(0, 120),
    province: String(raw.province || '').slice(0, 120),
    postalCode: String(raw.postalCode || '').slice(0, 12),
    bedrooms: num(raw.bedrooms),
    bathrooms: num(raw.bathrooms),
    builtArea: num(raw.builtArea),
    usableArea: num(raw.usableArea),
    plotArea: num(raw.plotArea),
    floor: raw.floor === undefined || raw.floor === null ? '' : String(raw.floor).slice(0, 20),
    yearBuilt: num(raw.yearBuilt),
    age: num(raw.age),
    condition: String(raw.condition || '').slice(0, 80),
    orientation: String(raw.orientation || '').slice(0, 40),
    energy: String(raw.energy || '').slice(0, 10),
    features: Array.isArray(raw.features) ? raw.features.map((f) => String(f).slice(0, 60)).slice(0, 40) : [],
    description: String(raw.description || '').slice(0, 4000),
  }
}

/** A peer listing from apiweb → compact record with price per m². */
export function peerFromListing(p, rent) {
  const price = Number(rent ? p.precioalq : p.precioinmo) || 0
  const m2 = Number(p.m_cons) || Number(p.m_uties) || 0
  return {
    codOfer: Number(p.cod_ofer),
    ref: p.ref,
    price,
    m2,
    ppm2: price && m2 ? Math.round(price / m2) : null,
    // Inmovilla counts singles and doubles separately; a two-bedroom flat can have zero of the first.
    bedrooms: (Number(p.habitaciones) || 0) + (Number(p.habdobles) || 0),
    bathrooms: Number(p.banyos) || 0,
    city: p.ciudad || '',
    zone: p.zona || '',
    type: p.nbtipo || '',
  }
}

function quantile(sorted, q) {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo))
}

/** Peer statistics on €/m² plus where the property's own €/m² sits (percentile). */
export function peerStats(peers, property) {
  const values = peers.map((p) => p.ppm2).filter((v) => v && v > 0).sort((a, b) => a - b)
  const propertyPpm2 = property.price && property.builtArea ? Math.round(property.price / property.builtArea) : null
  const below = propertyPpm2 ? values.filter((v) => v < propertyPpm2).length : 0
  return {
    count: values.length,
    min: values[0] ?? null,
    q1: quantile(values, 0.25),
    median: quantile(values, 0.5),
    q3: quantile(values, 0.75),
    max: values[values.length - 1] ?? null,
    mean: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null,
    propertyPpm2,
    percentile: propertyPpm2 && values.length ? Math.round((below / values.length) * 100) : null,
    medianValue: property.builtArea && values.length ? Math.round(quantile(values, 0.5) * property.builtArea) : null,
  }
}

/** Comparables through apiweb: same operation + type, same city when it yields enough. */
export async function fetchComparables(apiwebQuery, creds, property) {
  const rent = property.operation === 2
  const base = [`keyacci=${rent ? 2 : 1}`]
  if (property.typeKey) base.push(`key_tipo=${Number(property.typeKey)}`)
  const safeCity = property.city.replace(/[';\\%]/g, '')
  const query = async (where) => {
    const data = await apiwebQuery(creds, [{ type: 'paginacion', pos: 1, num: MAX_PEERS, where, order: 'fechaact desc' }])
    const section = Array.isArray(data?.paginacion) ? data.paginacion.slice(1) : []
    return section
  }
  let scope = 'city'
  let list = safeCity ? await query([...base, `ciudad='${safeCity}'`].join(' and ')) : []
  if (list.length < MIN_CITY_PEERS) {
    scope = 'type'
    list = await query(base.join(' and '))
  }
  const self = new Set([String(property.codOfer || ''), String(property.ref || '')])
  const peers = list
    .filter((p) => !self.has(String(p.cod_ofer)) && !self.has(String(p.ref)))
    .map((p) => peerFromListing(p, rent))
    .filter((p) => p.price > 0)
  return { peers, scope }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
export function buildPrompt(property, peers, stats, scope, locale) {
  const rent = property.operation === 2
  const lang = LANGUAGES[locale] || LANGUAGES.es
  const lines = []
  const add = (label, value, unit = '') => {
    if (value === null || value === undefined || value === '' || value === 0) return
    lines.push(`- ${label}: ${value}${unit}`)
  }
  add('Reference', property.ref)
  add('Operation', rent ? 'rental (monthly rent)' : 'sale')
  add('Type', property.type)
  add('Asking price', property.price, ' €' + (rent ? '/month' : ''))
  add('City', property.city)
  add('Zone', property.zone)
  add('Province', property.province)
  add('Postal code', property.postalCode)
  add('Bedrooms', property.bedrooms)
  add('Bathrooms', property.bathrooms)
  add('Built area', property.builtArea, ' m²')
  add('Usable area', property.usableArea, ' m²')
  add('Plot', property.plotArea, ' m²')
  add('Floor', property.floor)
  add('Year built', property.yearBuilt)
  add('Age', property.age, ' years')
  add('Condition', property.condition)
  add('Orientation', property.orientation)
  add('Energy rating', property.energy)
  if (property.features.length) lines.push(`- Features: ${property.features.join(', ')}`)
  if (property.description) lines.push(`- Description: ${property.description.replace(/\s+/g, ' ')}`)

  const peerLines = peers.slice(0, MAX_PEERS).map((p) => `${p.ref || p.codOfer}: ${p.price} €${p.m2 ? `, ${p.m2} m²` : ''}${p.ppm2 ? `, ${p.ppm2} €/m²` : ''}, ${p.bedrooms} bed, ${[p.zone, p.city].filter(Boolean).join(' / ')}`)
  const statLines = stats.count
    ? [
        `Comparable set: ${stats.count} listings of the same ${scope === 'city' ? 'operation, type and city' : 'operation and type (whole agency, city had too few)'} with a usable price per m².`,
        `€/m² min ${stats.min}, Q1 ${stats.q1}, median ${stats.median}, Q3 ${stats.q3}, max ${stats.max}, mean ${stats.mean}.`,
        stats.propertyPpm2 ? `This property asks ${stats.propertyPpm2} €/m² (percentile ${stats.percentile} of the peers); at the peer median it would be worth about ${stats.medianValue} €.` : 'This property has no usable price per m² (missing price or built area).',
      ]
    : ['No comparable listings with a usable price per m² were found: rely on general market knowledge for the area and say so in the summary.']

  const system = `You are a senior real-estate appraiser working for a Spanish agency. Value the property below for its agents: give a most-likely market value, a plausible range, and a suggested asking price, all in euros${rent ? ' per month' : ''}. Base the valuation on the comparable listings supplied (they are the agency's own asking prices, so they tend to sit slightly above closing prices), adjusted for the property's characteristics; use your general knowledge of the Spanish market for the location when the comparables are thin. Be concrete and numeric. Write every text field in ${lang}. Never mention that you are an AI.`
  const user = `PROPERTY\n${lines.join('\n')}\n\nPEER STATISTICS\n${statLines.join('\n')}\n\nCOMPARABLE LISTINGS (ref: price, built m², €/m², bedrooms, zone / city)\n${peerLines.join('\n') || '(none)'}`
  return { system, user }
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------
function normalizeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return Object.assign(new Error('Anthropic rechazó la clave API de la agencia'), { status: 401, code: 'anthropic' })
  if (err instanceof Anthropic.PermissionDeniedError) return Object.assign(new Error('La clave API de Anthropic no tiene permiso para este modelo'), { status: 401, code: 'anthropic' })
  if (err instanceof Anthropic.RateLimitError) return Object.assign(new Error('Anthropic limita las peticiones; inténtalo en un minuto'), { status: 429 })
  if (err instanceof Anthropic.APIConnectionError) return Object.assign(new Error('No se pudo conectar con Anthropic'), { status: 502 })
  if (err instanceof Anthropic.APIError) return Object.assign(new Error(`Anthropic respondió ${err.status}: ${err.message}`), { status: 502 })
  return Object.assign(new Error(err?.message || 'La valoración ha fallado'), { status: err?.status || 500 })
}

/** Ask Claude for the valuation (structured output; refusal fallbacks on). */
export async function askClaude(apiKey, { system, user }) {
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 })
  const params = {
    model: MODEL,
    max_tokens: 6000,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: betaZodOutputFormat(EstimateSchema) },
  }
  let response
  try {
    try {
      response = await client.beta.messages.parse({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    } catch (err) {
      // Fallbacks are a beta: if the account/platform does not accept them, run the plain request.
      if (err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) response = await client.beta.messages.parse(params)
      else throw err
    }
  } catch (err) {
    throw normalizeError(err)
  }
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('Claude no ha podido valorar esta propiedad'), { status: 502 })
  if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('La respuesta de Claude se ha cortado; inténtalo de nuevo'), { status: 502 })
  const parsed = response.parsed_output
  if (!parsed) throw Object.assign(new Error('Claude devolvió una respuesta que no se pudo interpretar'), { status: 502 })
  return { result: sanitize(parsed), model: response.model, usage: { input: response.usage?.input_tokens, output: response.usage?.output_tokens } }
}

/** Keeps the numbers coherent whatever the model returned. */
export function sanitize(r) {
  const n = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0)
  let low = n(r.rangeLow)
  let high = n(r.rangeHigh)
  let value = n(r.estimatedValue)
  if (high < low) [low, high] = [high, low]
  if (value < low || value > high) value = Math.round((low + high) / 2) || value
  return {
    estimatedValue: value,
    rangeLow: low,
    rangeHigh: high,
    confidence: ['low', 'medium', 'high'].includes(r.confidence) ? r.confidence : 'medium',
    verdict: ['underpriced', 'fair', 'overpriced'].includes(r.verdict) ? r.verdict : 'fair',
    summary: String(r.summary || ''),
    strengths: (r.strengths || []).map(String).slice(0, 8),
    weaknesses: (r.weaknesses || []).map(String).slice(0, 8),
    adjustments: (r.adjustments || []).map((a) => ({ factor: String(a.factor || ''), impactPct: Number(a.impactPct) || 0 })).slice(0, 8),
    suggestedPrice: n(r.suggestedPrice) || value,
  }
}

/** Cheap check used when an admin saves the key: a listing call needs a valid key and costs nothing. */
export async function verifyAnthropicKey(apiKey) {
  const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 })
  try {
    await client.models.list({ limit: 1 })
  } catch (err) {
    throw normalizeError(err)
  }
}

// ---------------------------------------------------------------------------
// Mock (INMOVILLA_MOCK=1): deterministic estimate from the peer statistics, no network
// ---------------------------------------------------------------------------
export function mockEstimate(property, stats, locale) {
  const rent = property.operation === 2
  const base = stats.medianValue || property.price || (rent ? 800 : 150_000)
  const bonus = (property.features.length >= 4 ? 0.04 : 0) + (/nuevo|reformad|neuf|rénov|new|renovat/i.test(property.condition + property.description) ? 0.05 : 0)
  const value = Math.round((base * (1 + bonus)) / (rent ? 10 : 1000)) * (rent ? 10 : 1000)
  const low = Math.round((value * 0.93) / (rent ? 10 : 1000)) * (rent ? 10 : 1000)
  const high = Math.round((value * 1.07) / (rent ? 10 : 1000)) * (rent ? 10 : 1000)
  const ratio = property.price ? property.price / value : 1
  const verdict = ratio < 0.95 ? 'underpriced' : ratio > 1.06 ? 'overpriced' : 'fair'
  const texts = {
    es: {
      summary: `Valoración de demostración calculada a partir de ${stats.count} inmuebles comparables de la agencia (mediana ${stats.median} €/m²). El precio pedido está ${verdict === 'fair' ? 'en línea con' : verdict === 'overpriced' ? 'por encima de' : 'por debajo de'} el mercado de la zona.`,
      strengths: ['Buena relación superficie/precio frente a los comparables', ...(property.features.length ? [`Extras valorados: ${property.features.slice(0, 3).join(', ')}`] : [])],
      weaknesses: ['Sin datos de ventas cerradas; se usan precios de oferta', ...(property.age && property.age > 25 ? ['Antigüedad superior a la media de los comparables'] : [])],
      adjustments: [{ factor: 'Mediana de comparables', impactPct: 0 }, { factor: 'Extras y estado', impactPct: Math.round(bonus * 100) }],
    },
    fr: {
      summary: `Estimation de démonstration calculée à partir de ${stats.count} biens comparables de l'agence (médiane ${stats.median} €/m²). Le prix demandé est ${verdict === 'fair' ? 'en ligne avec' : verdict === 'overpriced' ? 'au-dessus du' : 'en dessous du'} marché du secteur.`,
      strengths: ['Bon rapport surface/prix face aux comparables', ...(property.features.length ? [`Équipements valorisés : ${property.features.slice(0, 3).join(', ')}`] : [])],
      weaknesses: ["Pas de ventes conclues ; prix d'offre utilisés", ...(property.age && property.age > 25 ? ['Ancienneté supérieure à la moyenne des comparables'] : [])],
      adjustments: [{ factor: 'Médiane des comparables', impactPct: 0 }, { factor: 'Équipements et état', impactPct: Math.round(bonus * 100) }],
    },
    en: {
      summary: `Demo valuation computed from ${stats.count} comparable listings of the agency (median ${stats.median} €/m²). The asking price is ${verdict === 'fair' ? 'in line with' : verdict === 'overpriced' ? 'above' : 'below'} the local market.`,
      strengths: ['Good surface/price ratio against the comparables', ...(property.features.length ? [`Valued extras: ${property.features.slice(0, 3).join(', ')}`] : [])],
      weaknesses: ['No closed sales available; asking prices used', ...(property.age && property.age > 25 ? ['Older than the average comparable'] : [])],
      adjustments: [{ factor: 'Peer median', impactPct: 0 }, { factor: 'Extras and condition', impactPct: Math.round(bonus * 100) }],
    },
  }
  const tx = texts[locale] || texts.es
  return {
    result: sanitize({ estimatedValue: value, rangeLow: low, rangeHigh: high, confidence: stats.count >= 10 ? 'medium' : 'low', verdict, ...tx, suggestedPrice: Math.round((value * 1.03) / (rent ? 10 : 1000)) * (rent ? 10 : 1000) }),
    model: 'mock',
    usage: { input: 0, output: 0 },
  }
}

/**
 * Full pipeline. `apiwebQuery(creds, requests)` is the relay's apiweb caller.
 */
export async function estimateProperty({ apiwebQuery, creds, input, locale = 'es', mock = false }) {
  const property = normalizeInput(input)
  if (!property.price) throw Object.assign(new Error('La propiedad necesita un precio para valorarla'), { status: 400 })
  const { peers, scope } = await fetchComparables(apiwebQuery, creds, property)
  const stats = peerStats(peers, property)
  const prompt = buildPrompt(property, peers, stats, scope, locale)
  const answer = mock ? mockEstimate(property, stats, locale) : await askClaude(creds.anthropicKey, prompt)
  return { property, peers, stats, scope, ...answer, locale, at: Date.now() }
}
