import { mkdtemp, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PropertiesStore, sanitizeProperty } from '../server/propertiesStore.js'
import { completeness, emptyProperty, matchesProperty, priceOf, suggestRef, titleOf, validateProperty } from '../src/models/property.js'

const base = (over = {}) => ({ ...emptyProperty(), id: 'prop00000001', type: 'Piso', city: 'Alicante', price: 150000, updatedAt: 1000, createdAt: 1000, ...over })

describe('sanitizeProperty', () => {
  it('normalises fields, features and photo list', () => {
    const p = sanitizeProperty(
      { id: 'prop00000001', price: '185000', features: { ascensor: true, bogus: 1 }, photos: [{ id: 'photo0000001' }, { id: 'x' }, { id: 'photo0000002', order: 5, caption: 'Salón' }], updatedAt: 7 },
      1_000_000,
    )
    expect(p.price).toBe(185000)
    expect(p.features.ascensor).toBe(1)
    expect(p.features.terraza).toBe(0)
    expect(p.features.bogus).toBeUndefined()
    expect(p.photos).toEqual([{ id: 'photo0000001', order: 0, caption: '' }, { id: 'photo0000002', order: 5, caption: 'Salón' }])
    expect(p.status).toBe('draft')
    expect(p.operation).toBe('sale')
  })
  it('rejects invalid ids', () => {
    expect(sanitizeProperty({ id: '!' })).toBeNull()
  })
})

describe('PropertiesStore photos', () => {
  it('stores, lists and prunes photo files following the property record', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'alma-props-'))
    const store = new PropertiesStore(path.join(dir, 'properties.json'), path.join(dir, 'photos'))
    await store.load()
    store.apply('1', [base({ photos: [{ id: 'photo0000001', order: 0 }, { id: 'photo0000002', order: 1 }] })], 5000)
    expect(store.hasPhotoRef('1', 'prop00000001', 'photo0000001')).toBe(true)
    expect(store.hasPhotoRef('1', 'prop00000001', 'photo0000009')).toBe(false)
    expect(store.hasPhotoRef('2', 'prop00000001', 'photo0000001')).toBe(false)

    await store.savePhoto('1', 'prop00000001', 'photo0000001', Buffer.from('jpegdata'))
    await store.savePhoto('1', 'prop00000001', 'photo0000002', Buffer.from('jpegdata2'))
    expect((await store.storedPhotoIds('1', 'prop00000001')).sort()).toEqual(['photo0000001', 'photo0000002'])
    expect(await readFile(store.photoPath('1', 'prop00000001', 'photo0000001'), 'utf8')).toBe('jpegdata')

    // photo 2 removed from the listing -> file pruned
    store.apply('1', [base({ photos: [{ id: 'photo0000001', order: 0 }], updatedAt: 2000 })], 5000)
    await store.pruneOrphanPhotos('1', 'prop00000001')
    expect(await store.storedPhotoIds('1', 'prop00000001')).toEqual(['photo0000001'])

    // property deleted -> directory gone
    store.apply('1', [base({ deleted: true, updatedAt: 3000 })], 5000)
    await store.pruneOrphanPhotos('1', 'prop00000001')
    await expect(stat(store.photoDir('1', 'prop00000001'))).rejects.toThrow()
    expect(await store.photoExists('1', 'prop00000001', 'photo0000001')).toBe(false)
  })
})

describe('property model', () => {
  it('validates required fields per operation', () => {
    expect(validateProperty(base({ price: null }))).toHaveProperty('price')
    expect(validateProperty(base({ operation: 'rent', priceRent: null }))).toHaveProperty('priceRent')
    expect(validateProperty(base({ operation: 'rent', priceRent: 800 }))).toEqual({})
    expect(validateProperty(base({ city: '' }))).toHaveProperty('city')
    expect(validateProperty(base({ postalCode: 'abc' }))).toHaveProperty('postalCode')
    expect(validateProperty(base({ yearBuilt: 1200 }))).toHaveProperty('yearBuilt')
    expect(validateProperty(base())).toEqual({})
  })

  it('formats title, price and completeness', () => {
    expect(titleOf(base())).toBe('Piso en Alicante')
    expect(titleOf(base({ title: ' Ático con vistas ' }))).toBe('Ático con vistas')
    expect(priceOf(base())).toMatch(/150\.000/)
    expect(priceOf(base({ operation: 'rent', priceRent: 900 }))).toMatch(/900.*\/mes/)
    expect(priceOf(base({ price: null }))).toBe('Sin precio')
    expect(completeness(base())).toBeGreaterThan(0)
    expect(completeness(base())).toBeLessThan(completeness(base({ bedrooms: 3, bathrooms: 2, builtArea: 90, photos: [{ id: 'a' }] })))
  })

  it('suggests the next reference and searches accent-insensitively', () => {
    expect(suggestRef([])).toBe('ALMA-0001')
    expect(suggestRef([{ ref: 'ALMA-0007' }, { ref: 'X-12' }])).toBe('ALMA-0013')
    expect(matchesProperty(base({ zone: 'Jávea' }), 'javea')).toBe(true)
    expect(matchesProperty(base(), 'madrid')).toBe(false)
  })
})
