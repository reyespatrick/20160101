/**
 * The REST relay must hand Inmovilla the path exactly as documented, trailing slash included:
 * every route in the API REST v1 carries one ("/clientes/", "/propiedades/", "/enums/") and the
 * real API rejects the stripped form. Cloudflare's catch-all parameter drops it, so the relay
 * reads the path off the URL instead — this pins that behaviour.
 */
import { describe, expect, it } from 'vitest'

/** Mirrors the derivation in functions/api/rest/[[path]].js */
function relayPath(requestUrl, base = '/api/rest') {
  const url = new URL(requestUrl)
  return (url.pathname.startsWith(base) ? url.pathname.slice(base.length) || '/' : '/') + url.search
}

describe('REST relay path', () => {
  it('keeps the trailing slash Inmovilla requires', () => {
    expect(relayPath('https://x.dev/api/rest/clientes/')).toBe('/clientes/')
    expect(relayPath('https://x.dev/api/rest/propiedades/')).toBe('/propiedades/')
    expect(relayPath('https://x.dev/api/rest/clientes/buscar/')).toBe('/clientes/buscar/')
  })

  it('keeps the query string', () => {
    expect(relayPath('https://x.dev/api/rest/clientes/buscar/?telefono=600111222')).toBe('/clientes/buscar/?telefono=600111222')
    expect(relayPath('https://x.dev/api/rest/enums/?tipos')).toBe('/enums/?tipos')
  })

  it('leaves a path without a trailing slash alone', () => {
    expect(relayPath('https://x.dev/api/rest/clientes/5000')).toBe('/clientes/5000')
  })

  it('never returns an empty path', () => {
    expect(relayPath('https://x.dev/api/rest')).toBe('/')
    expect(relayPath('https://x.dev/api/rest/')).toBe('/')
  })
})
