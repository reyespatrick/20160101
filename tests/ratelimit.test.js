/**
 * apiweb rate limiter. Inmovilla blocks the caller's IP for 10 minutes at 70 requests
 * per minute, permanently after 10 such blocks, so this must hold the line on its own.
 */
import { describe, expect, it } from 'vitest'
import { buildFormBody, createRateLimiter, normalizeRequest, visitorIp } from '../server/inmovilla.js'

/** Virtual clock: the limiter's waits move time forward instead of really sleeping. */
function fakeClock() {
  let t = 0
  return {
    now: () => t,
    sleep: (ms) => {
      t += ms
      return Promise.resolve()
    },
    advance: (ms) => (t += ms),
    get time() {
      return t
    },
  }
}

describe('createRateLimiter', () => {
  it('lets the first `limit` calls through without waiting', async () => {
    const c = fakeClock()
    const slot = createRateLimiter({ limit: 3, now: c.now, sleep: c.sleep })
    for (let i = 0; i < 3; i++) await slot()
    expect(c.time).toBe(0)
    expect(slot.pending()).toBe(3)
  })

  it('delays the call that would exceed the window', async () => {
    const c = fakeClock()
    const slot = createRateLimiter({ limit: 2, windowMs: 1000, now: c.now, sleep: c.sleep })
    await slot()
    c.advance(200)
    await slot()
    await slot() // must wait for the first one to leave the window
    expect(c.time).toBeGreaterThanOrEqual(1000)
    expect(c.time).toBeLessThan(1200)
  })

  it('never lets concurrent callers exceed the limit', async () => {
    const c = fakeClock()
    const slot = createRateLimiter({ limit: 5, windowMs: 1000, maxWaitMs: 60_000, now: c.now, sleep: c.sleep })
    const stamps = []
    await Promise.all(Array.from({ length: 12 }, () => slot().then(() => stamps.push(c.time))))
    // in any 1000 ms window there must never be more than 5 calls
    for (const start of stamps) {
      expect(stamps.filter((t) => t >= start && t < start + 1000).length).toBeLessThanOrEqual(5)
    }
    expect(stamps).toHaveLength(12)
  })

  it('gives up rather than queue forever', async () => {
    const c = fakeClock()
    const slot = createRateLimiter({ limit: 1, windowMs: 60_000, maxWaitMs: 1000, now: c.now, sleep: c.sleep })
    await slot()
    await expect(slot()).rejects.toMatchObject({ status: 429 })
  })

  it('frees slots again once the window has passed', async () => {
    const c = fakeClock()
    const slot = createRateLimiter({ limit: 2, windowMs: 1000, now: c.now, sleep: c.sleep })
    await slot()
    await slot()
    c.advance(1001)
    await slot()
    expect(c.time).toBe(1001) // no wait needed
    expect(slot.pending()).toBe(1)
  })

  it('stays under Inmovilla\'s 70 per minute with the shipped default of 60', async () => {
    const c = fakeClock()
    const slot = createRateLimiter({ limit: 60, windowMs: 60_000, maxWaitMs: 120_000, now: c.now, sleep: c.sleep })
    const stamps = []
    for (let i = 0; i < 90; i++) {
      await slot()
      stamps.push(c.time)
    }
    for (const start of stamps) {
      expect(stamps.filter((t) => t >= start && t < start + 60_000).length).toBeLessThan(70)
    }
  })
})

describe('apiweb request body', () => {
  it('keeps a composite USUARIO_API such as 123_244_ext intact', () => {
    const body = buildFormBody({ numagencia: '123_244_ext', password: 'MyClave', idioma: 1 }, [normalizeRequest({ type: 'paginacion', pos: 1, num: 20 })])
    expect(body.get('param')).toBe('123_244_ext;MyClave;1;lostipos;paginacion;1;20;;')
    expect(body.get('json')).toBe('1')
  })

  it('sends the visitor IP as both ia and ib, and the domain when set', () => {
    const body = buildFormBody({ numagencia: '2', password: 'p' }, [normalizeRequest({ type: 'ficha', pos: 1, num: 1 })], { clientIp: '81.2.3.4', domain: 'midominio.com' })
    expect(body.get('ia')).toBe('81.2.3.4')
    expect(body.get('ib')).toBe('81.2.3.4')
    expect(body.get('elDominio')).toBe('midominio.com')
  })

  it('never leaves the visitor IP empty, whatever the caller looks like', () => {
    // apiweb answers "NECESITAMOS RECIBIR LA IP" for a missing or unusable ia,
    // which is what a server-to-server call would otherwise send.
    for (const caller of ['', undefined, '127.0.0.1', '::1', '10.0.0.5', '192.168.1.20', '172.20.1.1', 'fe80::1']) {
      const body = buildFormBody({ numagencia: '2', password: 'p' }, [normalizeRequest({ type: 'paginacion', pos: 1, num: 1 })], { clientIp: caller })
      expect(body.get('ia')).toBe('8.8.8.8')
      expect(body.get('ib')).toBe('8.8.8.8')
    }
  })

  it('honours a configured fallback and keeps a real public caller', () => {
    expect(visitorIp('', '81.9.9.9')).toBe('81.9.9.9')
    expect(visitorIp('195.15.213.10')).toBe('195.15.213.10')
    expect(visitorIp('2a06:98c0:3600::103')).toBe('2a06:98c0:3600::103')
    expect(visitorIp('172.15.0.1')).toBe('172.15.0.1') // just outside the private block
  })
})
