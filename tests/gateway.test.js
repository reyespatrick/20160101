import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ClientsStore } from '../server/clientsStore.js'
import { Forwarder } from '../server/forwarder.js'
import { extractRemoteId, toInmovillaClient, toInmovillaProperty } from '../server/inmovillaMapping.js'
import { InmovillaRest } from '../server/inmovillaRest.js'
import { PropertiesStore } from '../server/propertiesStore.js'
import { emptyClient } from '../src/models/client.js'
import { emptyProperty } from '../src/models/property.js'
import { applyRemoteChanges, pickWinner } from '../src/sync/merge.js'

const prop = (over = {}) => ({ ...emptyProperty(), id: 'prop00000001', type: 'Ático', city: 'Alicante', price: 185000, updatedAt: 1000, createdAt: 1000, ...over })
const cli = (over = {}) => ({ ...emptyClient(), id: 'clie00000001', name: 'Ana', updatedAt: 1000, createdAt: 1000, ...over })

describe('mapping to Inmovilla payloads', () => {
  it('maps a sale listing with features and drops empty fields', () => {
    const payload = toInmovillaProperty(prop({ features: { ascensor: 1, terraza: 0 }, status: 'ready', bedrooms: 3 }))
    expect(payload).toMatchObject({ keyacci: 1, nbtipo: 'Ático', precioinmo: 185000, ciudad: 'Alicante', habitaciones: 3, ascensor: 1, terraza: 0, eninternet: 1 })
    expect(payload).not.toHaveProperty('precioalq')
    expect(payload).not.toHaveProperty('zona')
  })
  it('maps a rental and a client', () => {
    expect(toInmovillaProperty(prop({ operation: 'rent', priceRent: 900 }))).toMatchObject({ keyacci: 2, precioalq: 900 })
    expect(toInmovillaClient(cli({ surname: 'Ruiz', phone: '600', operation: 'buy', zones: ['Centro', 'Playa'], budgetMax: 250000 }))).toMatchObject({
      nombre: 'Ana', apellidos: 'Ruiz', telefono: '600', keyacci: 1, zonas: 'Centro, Playa', preciomax: 250000,
    })
  })
  it('extracts ids from several response shapes', () => {
    expect(extractRemoteId({ cod_ofer: 123 })).toBe('123')
    expect(extractRemoteId({ data: { id: 'abc' } })).toBe('abc')
    expect(extractRemoteId(77)).toBe('77')
    expect(extractRemoteId({})).toBeNull()
  })
})

describe('InmovillaRest', () => {
  it('sends the Token header and JSON body, surfaces HTTP errors', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, init })
      return url.endsWith('/fail') ? new Response('boom', { status: 500 }) : new Response(JSON.stringify({ id: 42 }), { status: 200 })
    }
    const rest = new InmovillaRest({ baseUrl: 'https://x.test/api/v1/', token: 'tok', fetchImpl })
    expect(rest.dryRun).toBe(false)
    expect(await rest.createClient(cli())).toBe('42')
    expect(calls[0].url).toBe('https://x.test/api/v1/clientes')
    expect(calls[0].init.headers.Token).toBe('tok')
    expect(JSON.parse(calls[0].init.body).nombre).toBe('Ana')
    await expect(rest.request('GET', '/fail')).rejects.toMatchObject({ status: 500 })
  })
  it('is a dry run without a token', async () => {
    const rest = new InmovillaRest({ token: '' })
    expect(rest.dryRun).toBe(true)
    expect(await rest.createProperty(prop())).toMatch(/^dry-/)
  })
})

describe('Forwarder', () => {
  function fakeRest(overrides = {}) {
    const log = []
    const rest = {
      enabled: true,
      createProperty: async (r) => (log.push(['createProperty', r.id]), 'INMO-1'),
      updateProperty: async (id, r) => (log.push(['updateProperty', id, r.updatedAt]), id),
      deleteProperty: async (id) => log.push(['deleteProperty', id]),
      uploadPhoto: async (id, buf, o) => (log.push(['uploadPhoto', id, buf.toString(), o.order]), 'F1'),
      createClient: async (r) => (log.push(['createClient', r.id]), 'C-1'),
      updateClient: async (id) => (log.push(['updateClient', id]), id),
      deleteClient: async (id) => log.push(['deleteClient', id]),
      ...overrides,
    }
    return { rest, log }
  }

  it('creates, then updates on new versions, uploads photos once, deletes tombstones', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'alma-gw-'))
    const store = new PropertiesStore(path.join(dir, 'p.json'), path.join(dir, 'photos'))
    await store.load()
    const { rest, log } = fakeRest()
    const photos = { photo0000001: Buffer.from('img1') }
    const fw = new Forwarder({ store, rest, kind: 'property', log: { warn() {}, error() {} }, photoLoader: async (_a, _p, id) => photos[id] || null })

    store.apply('1', [prop({ photos: [{ id: 'photo0000001', order: 0 }, { id: 'photo0000002', order: 1 }] })], 5000)
    expect(await fw.run('1')).toEqual({ pushed: 1, failed: 0 })
    let rec = store.get('1', 'prop00000001')
    expect(rec.remote).toMatchObject({ id: 'INMO-1', state: 'synced', syncedVersion: 1000, photos: { photo0000001: 'F1' } })
    expect(rec.serverUpdatedAt).toBeGreaterThan(0)
    expect(store.list('1', 4999)).toHaveLength(1) // visible to devices via serverUpdatedAt

    // nothing pending now
    expect(await fw.run('1')).toEqual({ pushed: 0, failed: 0 })

    // second photo arrives later -> only it is uploaded
    photos.photo0000002 = Buffer.from('img2')
    store.setServerField('1', 'prop00000001', 'remote', { ...rec.remote, state: 'pending' })
    await fw.run('1')
    expect(log.filter((l) => l[0] === 'uploadPhoto').map((l) => l[2])).toEqual(['img1', 'img2'])

    // device edits -> update with remote id, remote state preserved through apply
    store.apply('1', [prop({ updatedAt: 2000, price: 190000 })], 6000)
    rec = store.get('1', 'prop00000001')
    expect(rec.remote.id).toBe('INMO-1')
    await fw.run('1')
    expect(log.some((l) => l[0] === 'updateProperty' && l[1] === 'INMO-1' && l[2] === 2000)).toBe(true)

    // delete
    store.apply('1', [prop({ deleted: true, updatedAt: 3000 })], 7000)
    await fw.run('1')
    expect(log.at(-1)).toEqual(['deleteProperty', 'INMO-1'])
    expect(store.get('1', 'prop00000001').remote.state).toBe('deleted')
  })

  it('records errors and retries on the next run', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'alma-gw-'))
    const store = new ClientsStore(path.join(dir, 'c.json'))
    await store.load()
    let fail = true
    const { rest } = fakeRest({ createClient: async () => { if (fail) throw new Error('400 telefono requerido'); return 'C-9' } })
    const fw = new Forwarder({ store, rest, kind: 'client', log: { warn() {}, error() {} } })
    store.apply('1', [cli()], 5000)
    expect(await fw.run('1')).toEqual({ pushed: 0, failed: 1 })
    expect(store.get('1', 'clie00000001').remote).toMatchObject({ state: 'error', error: '400 telefono requerido', attempts: 1 })
    fail = false
    expect(await fw.run('1')).toEqual({ pushed: 1, failed: 0 })
    expect(store.get('1', 'clie00000001').remote).toMatchObject({ id: 'C-9', state: 'synced', attempts: 0 })
  })
})

describe('device merge adopts server metadata', () => {
  it('takes the server copy on equal versions unless the device has unsent edits', () => {
    const local = cli({ updatedAt: 1000 })
    const server = cli({ updatedAt: 1000, remote: { id: 'C-1', state: 'synced', syncedVersion: 1000 } })
    expect(pickWinner(local, server)).toBe(server)
    expect(pickWinner({ ...local, dirty: true }, server)).toMatchObject({ dirty: true })
    const { merged } = applyRemoteChanges([local], [server])
    expect(merged[0].remote.id).toBe('C-1')
  })
})
