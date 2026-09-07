import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mockResponse } from '../server/mock.js'
import { createMockRest } from '../server/mockRest.js'
import { splitSection } from '../server/inmovilla.js'

let server, base
beforeAll(async () => {
  const app = express()
  app.use('/api/rest', createMockRest().router)
  await new Promise((resolve) => (server = app.listen(0, resolve)))
  base = `http://localhost:${server.address().port}/api/rest`
})
afterAll(() => server.close())
const call = (path, init = {}, token = 'demo-token') => fetch(base + path, { ...init, headers: { Token: token, 'Content-Type': 'application/json' } })
const json = async (p, i, t) => {
  const r = await call(p, i, t)
  return { status: r.status, body: await r.json() }
}

describe('mock REST (documented contract)', () => {
  it('requires the token and serves enums', async () => {
    expect((await json('/enums/?tipos', {}, 'bad')).status).toBe(401)
    const tipos = (await json('/enums/?tipos')).body
    expect(tipos.keyacci[0]).toEqual({ nombre: 'Vender', valor: 1 })
    expect(tipos.key_tipo.length).toBeGreaterThan(3)
    expect((await json('/enums/?tipos=keyori')).body.keyori).toHaveLength(8)
    const ciudades = (await json('/enums/?ciudades')).body
    expect(ciudades[0].ciudades[0]).toEqual({ ciudad: 'Alicante', key_loca: 31001 })
    const zonas = (await json('/enums/?zonas=31001')).body
    expect(zonas['31001'][0]).toMatchObject({ zona: 'Centro' })
    expect((await json('/enums/?zonas=abc')).body.codigo).toBe(400005)
  })

  it('creates, searches, updates and deletes clients', async () => {
    expect((await json('/clientes/', { method: 'POST', body: JSON.stringify({}) })).body).toMatchObject({ codigo: 406001 })
    expect((await json('/clientes/', { method: 'POST', body: JSON.stringify({ nombre: 'Ana', telefono2: '600' }) })).body.codigo).toBe(406002)
    const created = await json('/clientes/', { method: 'POST', body: JSON.stringify({ nombre: 'Ana', telefono2: 600123456 }) })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ codigo: 201 })
    const id = created.body.cod_cli
    expect((await json(`/clientes/?cod_cli=${id}`)).body.nombre).toBe('Ana')
    expect((await json('/clientes/buscar/?telefono=600123456')).body[0].cod_cli).toBe(String(id))
    expect((await json('/clientes/buscar/?telefono=1')).status).toBe(404)
    expect((await json('/clientes/', { method: 'PUT', body: JSON.stringify({ cod_cli: id, email: 'a@b.co' }) })).status).toBe(202)
    expect((await json(`/clientes/?cod_cli=${id}`)).body.email).toBe('a@b.co')
    expect((await json(`/clientes/${id}`, { method: 'DELETE' })).body.codigo).toBe(200)
    expect((await json(`/clientes/?cod_cli=${id}`)).status).toBe(404)
  })

  it('creates and updates listings by ref, mirrors them into the apiweb mock, links owners', async () => {
    expect((await json('/propiedades/', { method: 'POST', body: JSON.stringify({ ref: 'X' }) })).body.mensaje).toMatch(/keyacci requerido/)
    const payload = { ref: 'TEST-1', keyacci: 1, key_tipo: 5, key_loca: 31001, key_zona: 3100101, precioinmo: 185000, habitaciones: 3, ascensor: true, fotos: { 1: { url: 'https://x/a.jpg', posicion: 1 } } }
    expect((await json('/propiedades/', { method: 'POST', body: JSON.stringify(payload) })).body).toEqual({ codigo: 201, mensaje: 'Propiedad guardada' })
    const first = (await json('/propiedades/?ref=TEST-1')).body
    expect(first.cod_ofer).toBeGreaterThan(0)
    // apiweb mock sees it, with the REST-provided photo
    const web = mockResponse({ numagencia: '1234', password: 'demo' }, [{ type: 'paginacion', pos: 1, num: 1, where: "ref='TEST-1'", order: '' }])
    const item = splitSection(web.paginacion).items[0]
    expect(item).toMatchObject({ cod_ofer: first.cod_ofer, nbtipo: 'Ático', ciudad: 'Alicante', zona: 'Playa', precioinmo: 185000, foto: 'https://x/a.jpg' })
    // update keeps the cod_ofer
    await json('/propiedades/', { method: 'POST', body: JSON.stringify({ ...payload, precioinmo: 180000 }) })
    expect((await json('/propiedades/?ref=TEST-1')).body).toMatchObject({ cod_ofer: first.cod_ofer, precioinmo: 180000 })
    expect((await json('/propiedades/?listado')).body.some((p) => p.ref === 'TEST-1')).toBe(true)
    // owner
    const owner = await json('/propietarios/', { method: 'POST', body: JSON.stringify({ cod_ofer: first.cod_ofer, nombre: 'Luis', telefono1: 600000000 }) })
    expect(owner.status).toBe(201)
    expect((await json('/propietarios/', { method: 'POST', body: JSON.stringify({ cod_ofer: 1, nombre: 'Luis' }) })).status).toBe(404)
  })
})
