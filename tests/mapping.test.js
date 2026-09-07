import { describe, expect, it } from 'vitest'
import { extractId, extractList, fromInmovillaClient, toInmovillaClient, toInmovillaProperty } from '../src/api/inmovillaMapping.js'
import { emptyClient } from '../src/models/client.js'
import { emptyProperty } from '../src/models/property.js'
import { mergeRemoteList, pendingRecords, planFor } from '../src/sync/outbox.js'

const prop = (over = {}) => ({ ...emptyProperty(), id: 'p1', type: 'Ático', city: 'Alicante', price: 185000, ...over })
const cli = (over = {}) => ({ ...emptyClient(), id: 'c1', name: 'Ana', updatedAt: 1000, ...over })

describe('mapping to Inmovilla payloads', () => {
  it('maps a sale listing with features and drops empty fields', () => {
    const payload = toInmovillaProperty(prop({ features: { ascensor: 1, terraza: 0 }, status: 'ready', bedrooms: 3 }))
    expect(payload).toMatchObject({ keyacci: 1, nbtipo: 'Ático', precioinmo: 185000, ciudad: 'Alicante', habitaciones: 3, ascensor: 1, terraza: 0, eninternet: 1 })
    expect(payload).not.toHaveProperty('precioalq')
    expect(payload).not.toHaveProperty('zona')
  })
  it('maps a rental and a client both ways', () => {
    expect(toInmovillaProperty(prop({ operation: 'rent', priceRent: 900 }))).toMatchObject({ keyacci: 2, precioalq: 900 })
    const out = toInmovillaClient(cli({ surname: 'Ruiz', phone: '600', operation: 'buy', zones: ['Centro', 'Playa'], budgetMax: 250000 }))
    expect(out).toMatchObject({ nombre: 'Ana', apellidos: 'Ruiz', telefono: '600', keyacci: 1, zonas: 'Centro, Playa', preciomax: 250000 })
    const back = fromInmovillaClient({ ...out, id: 77, fechaalta: '2026-09-01T10:00:00Z' })
    expect(back).toMatchObject({ id: 'inmo-77', remoteId: '77', name: 'Ana', surname: 'Ruiz', operation: 'buy', zones: ['Centro', 'Playa'], budgetMax: 250000 })
    expect(fromInmovillaClient({ nombre: 'sin id' })).toBeNull()
  })
  it('extracts ids and lists from several response shapes', () => {
    expect(extractId({ cod_ofer: 123 })).toBe('123')
    expect(extractId({ data: { id: 'abc' } })).toBe('abc')
    expect(extractId(77)).toBe('77')
    expect(extractId({})).toBeNull()
    expect(extractList([1, 2])).toEqual([1, 2])
    expect(extractList({ data: [1] })).toEqual([1])
    expect(extractList({ clientes: [1, 2, 3] })).toHaveLength(3)
    expect(extractList('nope')).toEqual([])
  })
})

describe('outbox', () => {
  it('plans create/update/delete/drop', () => {
    expect(planFor(cli({ dirty: true }))).toBe('create')
    expect(planFor(cli({ dirty: true, remoteId: '1' }))).toBe('update')
    expect(planFor(cli({ dirty: true, remoteId: '1', deleted: true }))).toBe('delete')
    expect(planFor(cli({ dirty: true, deleted: true }))).toBe('drop')
    expect(pendingRecords([cli({ dirty: true }), cli({ id: 'c2' })])).toHaveLength(1)
  })
  it('merges the Inmovilla list into the cache, keeping unsent edits and offline creations', () => {
    const local = [
      cli({ id: 'inmo-1', remoteId: '1', name: 'clean → replaced' }),
      cli({ id: 'inmo-2', remoteId: '2', name: 'dirty local edit', dirty: true }),
      cli({ id: 'inmo-3', remoteId: '3', name: 'deleted remotely' }),
      cli({ id: 'local-4', name: 'created offline', dirty: true }),
    ]
    const remote = [cli({ id: 'inmo-1', remoteId: '1', name: 'from Inmovilla' }), cli({ id: 'inmo-2', remoteId: '2', name: 'remote 2' }), cli({ id: 'inmo-5', remoteId: '5', name: 'new remote' })]
    const merged = mergeRemoteList(local, remote)
    const names = Object.fromEntries(merged.map((c) => [c.id, c.name]))
    expect(names).toEqual({ 'inmo-1': 'from Inmovilla', 'inmo-2': 'dirty local edit', 'inmo-5': 'new remote', 'local-4': 'created offline' })
    expect(merged.find((c) => c.id === 'inmo-1').dirty).toBe(false)
  })
})
