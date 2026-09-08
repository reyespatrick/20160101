import { describe, expect, it } from 'vitest'
import { buildPrompt, estimateProperty, fetchComparables, mockEstimate, normalizeInput, peerFromListing, peerStats, sanitize } from '../server/estimate.js'
import { mockResponse } from '../server/mock.js'

const creds = { numagencia: '1234', password: 'demo', idioma: 1, anthropicKey: 'sk-ant-demo' }
const apiweb = async (c, requests) => mockResponse(c, requests.map((r) => ({ type: r.type, pos: r.pos, num: r.num, where: r.where || '', order: r.order || '' })))

describe('peer statistics', () => {
  it('computes quartiles, median and the property percentile', () => {
    const peers = [1000, 1200, 1400, 1600, 1800, 2000].map((ppm2, i) => ({ ref: `P${i}`, price: ppm2 * 100, m2: 100, ppm2 }))
    const s = peerStats(peers, { price: 150_000, builtArea: 100 })
    expect(s).toMatchObject({ count: 6, min: 1000, max: 2000, median: 1500, q1: 1250, q3: 1750, propertyPpm2: 1500, percentile: 50, medianValue: 150_000 })
  })
  it('handles no usable peers', () => {
    const s = peerStats([{ ppm2: null }], { price: 1000, builtArea: 0 })
    expect(s.count).toBe(0)
    expect(s.median).toBeNull()
    expect(s.percentile).toBeNull()
  })
  it('builds peers from apiweb listings (sale vs rent price)', () => {
    expect(peerFromListing({ cod_ofer: 1, ref: 'A', precioinmo: 200_000, precioalq: 0, m_cons: 100, habitaciones: 3 }, false)).toMatchObject({ price: 200_000, ppm2: 2000, bedrooms: 3 })
    expect(peerFromListing({ cod_ofer: 2, ref: 'B', precioinmo: 0, precioalq: 900, m_cons: 90 }, true)).toMatchObject({ price: 900, ppm2: 10 })
  })
})

describe('comparables through apiweb', () => {
  it('uses the same city when it has enough listings, excluding the property itself', async () => {
    const { peers, scope } = await fetchComparables(apiweb, creds, normalizeInput({ codOfer: 10001, ref: 'IMB-0001', operation: 1, typeKey: 1, city: 'Alicante', price: 100_000, builtArea: 80 }))
    expect(scope === 'city' || scope === 'type').toBe(true)
    expect(peers.every((p) => p.codOfer !== 10001)).toBe(true)
    expect(peers.every((p) => p.price > 0)).toBe(true)
  })
  it('falls back to the whole agency when the city is unknown', async () => {
    const { peers, scope } = await fetchComparables(apiweb, creds, normalizeInput({ operation: 1, typeKey: 3, city: 'Nowhere', price: 300_000, builtArea: 150 }))
    expect(scope).toBe('type')
    expect(peers.length).toBeGreaterThan(0)
    expect(peers.every((p) => p.type === 'Chalet')).toBe(true)
  })
})

describe('prompt and sanitising', () => {
  it('puts the property, the statistics and the peers in the prompt, in the requested language', () => {
    const property = normalizeInput({ ref: 'X-1', operation: 1, type: 'Piso', price: 180_000, city: 'Elche', builtArea: 90, features: ['ascensor'], description: 'Luminoso' })
    const peers = [{ ref: 'P1', price: 200_000, m2: 100, ppm2: 2000, bedrooms: 3, city: 'Elche', zone: 'Centro' }]
    const { system, user } = buildPrompt(property, peers, peerStats(peers, property), 'city', 'fr')
    expect(system).toContain('French')
    expect(user).toContain('X-1')
    expect(user).toContain('ascensor')
    expect(user).toContain('P1: 200000 €, 100 m², 2000 €/m²')
    expect(user).toContain('median 2000')
  })
  it('keeps the numbers coherent', () => {
    const r = sanitize({ estimatedValue: 500, rangeLow: 900, rangeHigh: 700, confidence: 'weird', verdict: 'x', strengths: ['a'], adjustments: [{ factor: 'f', impactPct: '3' }] })
    expect(r).toMatchObject({ rangeLow: 700, rangeHigh: 900, estimatedValue: 800, confidence: 'medium', verdict: 'fair', suggestedPrice: 800 })
    expect(r.adjustments[0].impactPct).toBe(3)
  })
  it('normalises loose input', () => {
    const p = normalizeInput({ operation: '2', price: '850', builtArea: '', bedrooms: 'x', features: 'nope', description: 'd' })
    expect(p).toMatchObject({ operation: 2, price: 850, builtArea: null, bedrooms: null, features: [], description: 'd' })
  })
})

describe('mock pipeline', () => {
  it('produces a full estimate without network', async () => {
    const out = await estimateProperty({ apiwebQuery: apiweb, creds, input: { codOfer: 10001, ref: 'IMB-0001', operation: 1, typeKey: 1, city: 'Alicante', price: 150_000, builtArea: 90 }, locale: 'es', mock: true })
    expect(out.model).toBe('mock')
    expect(out.result.rangeLow).toBeLessThanOrEqual(out.result.estimatedValue)
    expect(out.result.estimatedValue).toBeLessThanOrEqual(out.result.rangeHigh)
    expect(out.result.summary).toMatch(/demostración/)
    expect(out.stats.count).toBeGreaterThan(0)
    expect(out.peers.length).toBe(out.peers.filter((p) => p.price > 0).length)
  })
  it('refuses a property without price', async () => {
    await expect(estimateProperty({ apiwebQuery: apiweb, creds, input: { ref: 'A' }, mock: true })).rejects.toMatchObject({ status: 400 })
  })
  it('writes the mock texts in French and English too', () => {
    const stats = { count: 3, median: 1500, medianValue: 150_000 }
    expect(mockEstimate(normalizeInput({ price: 140_000, builtArea: 100 }), stats, 'fr').result.summary).toMatch(/démonstration/)
    expect(mockEstimate(normalizeInput({ price: 140_000, builtArea: 100 }), stats, 'en').result.summary).toMatch(/Demo/)
  })
})
