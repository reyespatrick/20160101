import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMockRest } from '../server/mockRest.js'

let server, base
beforeAll(async () => {
  const app = express()
  app.use('/api/rest', createMockRest().router)
  await new Promise((resolve) => (server = app.listen(0, resolve)))
  base = `http://localhost:${server.address().port}/api/rest`
})
afterAll(() => server.close())

const call = (path, init = {}, token = 'demo-token') =>
  fetch(base + path, { ...init, headers: { token, 'content-type': 'application/json', ...(init.headers || {}) } })

describe('mock REST API', () => {
  it('requires the demo token', async () => {
    expect((await call('/clientes', {}, 'bad')).status).toBe(401)
  })
  it('creates, lists, updates, deletes clients and validates required fields', async () => {
    expect((await call('/clientes', { method: 'POST', body: JSON.stringify({}) })).status).toBe(400)
    const created = await (await call('/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'Ana' }) })).json()
    expect(created.id).toBeTruthy()
    expect((await (await call('/clientes')).json()).data).toHaveLength(1)
    const updated = await (await call(`/clientes/${created.id}`, { method: 'PUT', body: JSON.stringify({ telefono: '600' }) })).json()
    expect(updated).toMatchObject({ nombre: 'Ana', telefono: '600' })
    expect((await call(`/clientes/${created.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await (await call('/clientes')).json()).data).toHaveLength(0)
  })
  it('creates listings and accepts photos', async () => {
    const created = await (await call('/propiedades', { method: 'POST', body: JSON.stringify({ ciudad: 'Elche', keyacci: 1 }) })).json()
    expect(created.cod_ofer).toBe(Number(created.id))
    const photo = await call(`/propiedades/${created.id}/fotos`, { method: 'POST', body: JSON.stringify({ foto: Buffer.from('img').toString('base64'), orden: 0 }) })
    expect(photo.status).toBe(201)
    expect((await (await call(`/propiedades/${created.id}`)).json()).numfotos).toBe(1)
    expect((await call('/propiedades/999/fotos', { method: 'POST', body: JSON.stringify({ foto: 'x' }) })).status).toBe(404)
  })
})
