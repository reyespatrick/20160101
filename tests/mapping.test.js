import { describe, expect, it } from 'vitest'
import { clientsFromSearch, errorMessage, fromInmovillaClient, parseCiudades, parseTipos, parseZonas, toInmovillaClient, toInmovillaOwner, toInmovillaProperty } from '../src/api/inmovillaMapping.js'
import { emptyClient, looksLikeEmail, looksLikePhone, matchesClient, splitPhone, validateClient, whatsappLink } from '../src/models/client.js'
import { emptyProperty, suggestRef, validateProperty } from '../src/models/property.js'
import { planFor, upsertRemote } from '../src/sync/outbox.js'

const cli = (over = {}) => ({ ...emptyClient(), id: 'c1', name: 'Ana', ...over })
const prop = (over = {}) => ({ ...emptyProperty(), id: 'p1', ref: 'APP-1', typeKey: 5, typeName: 'Ático', cityKey: 31001, cityName: 'Alicante', price: 185000, ...over })

describe('phones', () => {
  it('splits prefixes and keeps digits only', () => {
    expect(splitPhone('600 123 456')).toEqual({ prefix: null, number: 600123456 })
    expect(splitPhone('+34 600 123 456')).toEqual({ prefix: 34, number: 600123456 })
    expect(splitPhone('0033 6 12 34 56 78')).toEqual({ prefix: 33, number: 612345678 })
    expect(splitPhone('')).toEqual({ prefix: null, number: null })
    expect(whatsappLink('600123456')).toBe('https://wa.me/34600123456')
    expect(looksLikePhone('600 12 34')).toBe(true)
    expect(looksLikePhone('Ana')).toBe(false)
    expect(looksLikeEmail('a@b.co')).toBe(true)
  })
})

describe('client mapping', () => {
  it('maps to Inmovilla fields with numeric phones and drops empty values', () => {
    const out = toInmovillaClient(cli({ surname: 'Ruiz', mobile: '+34 600 123 456', phone: '965 000 111', email: 'a@b.co', notes: 'hola', street: '' }))
    expect(out).toEqual({ nombre: 'Ana', apellidos: 'Ruiz', email: 'a@b.co', telefono1: 965000111, telefono2: 600123456, prefijotel2: 34, observacion: 'hola' })
    expect(toInmovillaClient(cli({ remoteId: '77' }), { forUpdate: true }).cod_cli).toBe(77)
  })
  it('maps back from Inmovilla and from a search answer', () => {
    const c = fromInmovillaClient({ cod_cli: '13449756', nombre: 'Pedro', apellidos: 'Picapiedra', telefono1: 666554433, telefono2: 666221100, prefijotel2: 44, localidad: 'Elche', altacliente: '2018-03-01 12:53:25', agente: { nombre: 'Antonio', apellidos: 'P.' } })
    expect(c).toMatchObject({ id: 'inmo-13449756', remoteId: '13449756', name: 'Pedro', phone: '666554433', mobile: '+44 666221100', city: 'Elche', agentName: 'Antonio P.' })
    expect(fromInmovillaClient({ nombre: 'sin codigo' })).toBeNull()
    expect(clientsFromSearch({ cod_cli: 1, nombre: 'Uno' })).toHaveLength(1)
    expect(clientsFromSearch([{ cod_cli: 1 }, { cod_cli: 2 }])).toHaveLength(2)
  })
  it('validates and searches', () => {
    expect(validateClient(cli({ name: '' }))).toHaveProperty('name')
    expect(validateClient(cli({ mobile: '12' }))).toHaveProperty('mobile')
    expect(validateClient(cli({ email: 'x' }))).toHaveProperty('email')
    expect(validateClient(cli({ mobile: '600123456', email: 'a@b.co' }))).toEqual({})
    const c = cli({ surname: 'Núñez', mobile: '+34 600 12 34 56', nif: 'Z1' })
    expect(matchesClient(c, 'nunez')).toBe(true)
    expect(matchesClient(c, '6001234')).toBe(true)
    expect(matchesClient(c, 'z1')).toBe(true)
    expect(matchesClient(c, 'pepe')).toBe(false)
  })
})

describe('property mapping', () => {
  it('builds the POST payload with enum codes, booleans and photo URLs', () => {
    const out = toInmovillaProperty(prop({ features: { ascensor: true, plaza_gara: true, terraza: false }, zoneName: 'Playa', bedrooms: 3, floor: 2, yearBuilt: 2005, conservation: 2, publish: 1 }), ['https://x/a.jpg', 'https://x/b.jpg'])
    expect(out).toMatchObject({ ref: 'APP-1', keyacci: 1, key_tipo: 5, key_loca: 31001, zona: 'Playa', prospecto: false, nodisponible: false, precioinmo: 185000, habitaciones: 3, planta: 2, antiguedad: 2005, conservacion: 2, eninternet: 1, ascensor: true, plaza_gara: 1, terraza: false })
    expect(out).not.toHaveProperty('precioalq')
    expect(out).not.toHaveProperty('key_zona')
    expect(out.fotos).toEqual({ 1: { url: 'https://x/a.jpg', posicion: 1 }, 2: { url: 'https://x/b.jpg', posicion: 2 } })
  })
  it('handles rentals, zones by code, unavailability and owners', () => {
    const out = toInmovillaProperty(prop({ operation: 2, priceRent: 900, zoneKey: 3100101, zoneName: 'ignored', unavailable: true }))
    expect(out).toMatchObject({ keyacci: 2, precioalq: 900, key_zona: 3100101, nodisponible: true })
    expect(out).not.toHaveProperty('zona')
    expect(out).not.toHaveProperty('fotos')
    expect(toInmovillaOwner(prop({ codOfer: '55', ownerName: 'Luis', ownerPhone: '600 1 2 3 4 5 6' }))).toEqual({ cod_ofer: 55, nombre: 'Luis', telefono1: 600123456 })
    expect(toInmovillaOwner(prop({ ownerRemoteId: '9', ownerName: 'Luis' }), { forUpdate: true })).toEqual({ cod_cli: 9, nombre: 'Luis' })
  })
  it('validates required Inmovilla fields', () => {
    // Inmovilla needs nombre and apellidos to create the owner, so the form asks for both.
    const complete = { ownerName: 'Carmen', ownerSurname: 'Ortiz', ownerPhone: '600111222', builtArea: 92, conservation: 2 }
    expect(validateProperty(prop(complete))).toEqual({})
    // Photographs are what an agent adds last, sometimes from the car: never a reason to refuse
    // the listing they have just spent ten minutes writing.
    expect(validateProperty(prop({ ...complete, photos: [] }))).toEqual({})
    expect(validateProperty(prop({ ...complete, ownerName: '' }))).toHaveProperty('ownerName')
    expect(validateProperty(prop({ ...complete, ownerSurname: '  ' }))).toHaveProperty('ownerSurname')
    expect(validateProperty(prop({ ...complete, typeKey: null }))).toHaveProperty('typeKey')
    // The town only has to be named: Inmovilla's key_loca is resolved in the background, and a
    // draft written in front of the door must not wait for it.
    expect(validateProperty(prop({ ...complete, cityName: '' }))).toHaveProperty('cityName')
    // A listing captured in front of the door, with no network to name the town: the position
    // stands in for it, and the address is read later from those same coordinates.
    expect(validateProperty(prop({ ...complete, cityName: '', latitude: 36.5957, longitude: -4.6377 }))).toEqual({})
    expect(validateProperty(prop({ ...complete, cityKey: null }))).toEqual({})
    expect(validateProperty(prop({ ...complete, ref: 'a b' }))).toHaveProperty('ref')
    expect(validateProperty(prop({ ...complete, operation: 2, priceRent: null }))).toHaveProperty('priceRent')
    expect(suggestRef('APP')).toMatch(/^APP-\d{6}-[A-Z0-9]{3}$/)
  })
})

describe('enum parsing and errors', () => {
  it('parses tipos, ciudades and zonas', () => {
    expect(parseTipos({ keyacci: [{ nombre: 'Vender', valor: 1 }], junk: 'x' })).toEqual({ keyacci: [{ value: 1, label: 'Vender' }] })
    expect(parseCiudades([{ provincia: 'ALICANTE', cod_prov: 4, ciudades: [{ ciudad: 'Agost', key_loca: 31699 }] }])).toEqual([{ key_loca: 31699, ciudad: 'Agost', provincia: 'ALICANTE', cod_prov: 4 }])
    expect(parseZonas({ 31699: [{ zona: 'Partida', key_zona: 2512711 }, { ciudad: 'Urb.', key_loca: 883111 }] })).toEqual({ 31699: [{ key_zona: 2512711, zona: 'Partida' }, { key_zona: 883111, zona: 'Urb.' }] })
  })
  it('renders Inmovilla error bodies', () => {
    expect(errorMessage({ codigo: 406001, mensaje: 'Campo nombre requerido' }, 406)).toBe('Campo nombre requerido (406001)')
    expect(errorMessage(null, 408)).toMatch(/limita/)
    expect(errorMessage('boom', 500)).toBe('boom')
  })
})

describe('outbox', () => {
  it('plans and merges search results without touching unsent edits', () => {
    expect(planFor({ dirty: true })).toBe('create')
    expect(planFor({ dirty: true, remoteId: '1' })).toBe('update')
    expect(planFor({ dirty: true, remoteId: '1', deleted: true })).toBe('delete')
    const local = [cli({ id: 'inmo-1', remoteId: '1', name: 'local dirty', dirty: true }), cli({ id: 'inmo-2', remoteId: '2', name: 'old' })]
    const merged = upsertRemote(local, [cli({ id: 'inmo-1', remoteId: '1', name: 'remote' }), cli({ id: 'inmo-2', remoteId: '2', name: 'new' }), cli({ id: 'inmo-3', remoteId: '3', name: 'added' })])
    expect(merged.map((c) => c.name)).toEqual(['local dirty', 'new', 'added'])
  })
})

/**
 * The number is the only key Inmovilla lets us search a contact on, so the shape we search with
 * has to be the shape we wrote. Getting that wrong does not fail loudly — it answers "nobody has
 * this number", and the duplicate is created by the very lookup meant to prevent it.
 */
describe('the phone as an identity', () => {
  it('searches with exactly what it would have written', async () => {
    const { phoneKey, splitPhone } = await import('../src/models/client.js')
    for (const written of ['+34 600 11 22 33', '0034600112233', '600 11 22 33', '600112233']) {
      expect(phoneKey(written)).toBe('600112233')
      expect(String(splitPhone(written).number)).toBe(phoneKey(written))
    }
    expect(phoneKey('')).toBe('')
    expect(phoneKey(null)).toBe('')
  })

  it('keeps the country code out of the number, where Inmovilla keeps it', async () => {
    const { splitPhone } = await import('../src/models/client.js')
    expect(splitPhone('+34 600 11 22 33')).toEqual({ prefix: 34, number: 600112233 })
    expect(splitPhone('+41 79 123 45 67')).toEqual({ prefix: 41, number: 791234567 })
    // No prefix marker: nothing is assumed, the digits are the number.
    expect(splitPhone('600112233')).toEqual({ prefix: null, number: 600112233 })
  })
})
