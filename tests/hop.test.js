import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiweb } from '../functions/_shared/inmovilla.js'
import { headerValue } from '../server/inmovilla.js'

/** A stand-in for deploy/iis-hop/apiweb.ashx: checks the secret and echoes what it would forward. */
let server, url, seen
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen = { secret: req.headers['x-hop-secret'], type: req.headers['content-type'], body }
      if (!['s3cret', 'ok'].includes(req.headers['x-hop-secret'])) {
        res.writeHead(403, { 'content-type': 'application/json' })
        return res.end('{"error":"hop secret missing or wrong"}')
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ paginacion: [{ posicion: 1, elementos: 0, total: 0 }] }))
    })
  })
  await new Promise((r) => server.listen(0, r))
  url = `http://localhost:${server.address().port}/apiweb.ashx`
})
afterAll(() => server.close())

describe('apiweb through a fixed-IP hop', () => {
  const creds = { numagencia: '123_244_ext', password: 'pw', idioma: 1 }
  it('sends the shared secret and the unchanged apiweb form body', async () => {
    const data = await apiweb({ INMOVILLA_API_URL: url, APIWEB_HOP_SECRET: 's3cret' }, creds, [{ type: 'paginacion', pos: 1, num: 5 }], { clientIp: '203.0.113.9' })
    expect(data.paginacion[0].total).toBe(0)
    expect(seen.secret).toBe('s3cret')
    expect(seen.type).toContain('application/x-www-form-urlencoded')
    const form = new URLSearchParams(seen.body)
    expect(form.get('param')).toMatch(/^123_244_ext;pw;1;/)
    expect(form.get('ia')).toBe('203.0.113.9')
    expect(form.get('json')).toBe('1')
  })
  it('surfaces the hop refusal when the secret is missing', async () => {
    await expect(apiweb({ INMOVILLA_API_URL: url }, creds, [{ type: 'paginacion', pos: 1, num: 5 }])).rejects.toMatchObject({ status: 502 })
    expect(seen.secret).toBeUndefined()
  })
})

describe('the hop secret survives the trip', () => {
  const creds = { numagencia: '123', password: 'pw', idioma: 1 }
  it('puts a non-ASCII secret on the wire as its UTF-8 bytes, which is what IIS decodes', async () => {
    // 'é' must leave as 0xC3 0xA9, not as the Latin-1 0xE9 a runtime would emit for the raw string.
    const secret = 'abcdéfgh'
    expect(headerValue(secret)).toBe('abcd\u00c3\u00a9fgh')
    expect([...headerValue(secret)].map((c) => c.charCodeAt(0))).toEqual([97, 98, 99, 100, 0xc3, 0xa9, 102, 103, 104])
    await apiweb({ INMOVILLA_API_URL: url, APIWEB_HOP_SECRET: 'ok' }, creds, [{ type: 'paginacion', pos: 1, num: 1 }])
    expect(seen.secret).toBe('ok') // ASCII secrets are untouched
  })
  it('leaves an ASCII secret exactly as configured', () => {
    expect(headerValue('sdlfhasdlfhaslfhjsalfjasdefjsd1231')).toBe('sdlfhasdlfhaslfhjsalfjasdefjsd1231')
    expect(headerValue('')).toBe('')
    expect(headerValue(undefined)).toBe('')
  })
})
