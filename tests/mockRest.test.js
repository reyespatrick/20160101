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

describe('mock REST: seguimientos and propietarios lookups', () => {
  it('serves follow-up types, creates, updates and searches follow-ups', async () => {
    const tipos = (await json('/enums/?tiposeguimiento')).body
    expect(tipos[0]).toMatchObject({ valor: 39 })
    const created = await json('/seguimientos/', { method: 'POST', body: JSON.stringify({ keytiposeg: 40, asunto: 'Llamar', fechaaviso: '2026-06-25 10:00:00' }) })
    expect(created.status).toBe(201)
    expect(created.body.codseg).toBeGreaterThan(0)
    expect((await json('/seguimientos/', { method: 'POST', body: JSON.stringify({ asunto: 'x', fechaaviso: 'mañana' }) })).body.codigo).toBe(406005)
    expect((await json('/seguimientos/', { method: 'POST', body: JSON.stringify({ asunto: 'x', keyprospecto: 999999 }) })).body.codigo).toBe(400003)
    const upd = await json('/seguimientos/', { method: 'POST', body: JSON.stringify({ codseg: created.body.codseg, tareacerrada: 1, fechafin: '2026-06-25 11:00:00' }) })
    expect(upd.status).toBe(202)
    expect((await json(`/seguimientos/?codseg=${created.body.codseg}`)).body).toMatchObject({ asunto: 'Llamar', tareacerrada: 1 })
    const today = new Date().toISOString().slice(0, 10)
    expect((await json(`/seguimientos/search/?fechaalta_desde=${today}&fechaalta_hasta=${today}`)).body.length).toBeGreaterThan(0)
    expect((await json('/seguimientos/search/?fechaalta_desde=2000-01-01&fechaalta_hasta=2000-01-02')).body).toEqual([])
  })
  it('looks owners up by property and lists their properties', async () => {
    await json('/propiedades/', { method: 'POST', body: JSON.stringify({ ref: 'OWN-1', keyacci: 1, key_tipo: 1, key_loca: 31001, precioinmo: 1000 }) })
    const prop = (await json('/propiedades/?ref=OWN-1')).body
    expect((await json(`/propietarios/?cod_ofer=${prop.cod_ofer}`)).status).toBe(404)
    const owner = await json('/propietarios/', { method: 'POST', body: JSON.stringify({ cod_ofer: prop.cod_ofer, nombre: 'Luis', telefono2: 600000000 }) })
    const byProp = (await json(`/propietarios/?cod_ofer=${prop.cod_ofer}`)).body
    expect(byProp).toMatchObject({ nombre: 'Luis' })
    expect(byProp.propiedades).toEqual([{ cod_ofer: String(prop.cod_ofer), ref: 'OWN-1', disponible: true }])
    expect((await json('/propietarios/?ref=OWN-1')).body.cod_cli).toBe(String(owner.body.cod_cli))
    expect((await json(`/propietarios/${owner.body.cod_cli}`, { method: 'DELETE' })).body.codigo).toBe(200)
  })
})
