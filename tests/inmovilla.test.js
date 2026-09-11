import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildFormBody, buildParam, normalizeRequest, parseApiResponse, splitSection } from '../server/inmovilla.js'
import { mockResponse } from '../server/mock.js'
import { buildWhere } from '../src/api/inmovilla.js'
import { featuresOf, isRent, priceOf } from '../src/utils/format.js'

describe('buildParam', () => {
  it('packs credentials and one request in Inmovilla order', () => {
    const param = buildParam({ numagencia: '1234', password: 'k3y', idioma: 1 }, [
      { type: 'paginacion', pos: 1, num: 20, where: 'keyacci=1', order: 'precioinmo asc' },
    ])
    expect(param).toBe('1234;k3y;1;lostipos;paginacion;1;20;keyacci=1;precioinmo asc')
  })

  it('appends multiple requests', () => {
    const param = buildParam({ numagencia: '1', password: 'p' }, [
      { type: 'paginacion', pos: 1, num: 5 },
      { type: 'ficha', pos: 1, num: 1, where: 'cod_ofer=99' },
    ])
    expect(param).toBe('1;p;1;lostipos;paginacion;1;5;;;ficha;1;1;cod_ofer=99;')
  })

  it('strips semicolons from user input so the protocol cannot be injected', () => {
    const param = buildParam({ numagencia: '1;2', password: 'p' }, [{ type: 'paginacion', where: "ref like 'a;b'" }])
    expect(param.split(';')).toHaveLength(9)
  })

  it('rejects unknown query types and missing credentials', () => {
    expect(() => normalizeRequest({ type: 'drop_table' })).toThrow(/Unsupported/)
    expect(() => buildParam({ numagencia: '', password: 'x' }, [{ type: 'paginacion' }])).toThrow(/numagencia/)
  })

  it('clamps page size', () => {
    expect(normalizeRequest({ type: 'paginacion', num: 5000 }).num).toBe(999)
    expect(normalizeRequest({ type: 'paginacion', num: -3 }).num).toBe(1)
  })
})

describe('buildFormBody', () => {
  it('sets json=1 and optional ip/domain', () => {
    const body = buildFormBody({ numagencia: '1', password: 'p' }, [{ type: 'paginacion' }], { clientIp: '1.2.3.4', domain: 'alma.example' })
    expect(body.get('json')).toBe('1')
    expect(body.get('ia')).toBe('1.2.3.4')
    expect(body.get('elDominio')).toBe('alma.example')
    expect(body.get('param')).toMatch(/^1;p;1;lostipos;paginacion/)
  })
})

describe('response parsing', () => {
  it('splits meta from items', () => {
    const { meta, items } = splitSection([{ posicion: 1, elementos: 2, total: 40 }, { cod_ofer: 1 }, { cod_ofer: 2 }])
    expect(meta).toEqual({ posicion: 1, elementos: 2, total: 40 })
    expect(items.map((i) => i.cod_ofer)).toEqual([1, 2])
  })

  it('handles empty sections', () => {
    expect(splitSection(undefined)).toEqual({ meta: { posicion: 1, elementos: 0, total: 0 }, items: [] })
  })

  it('turns non JSON and error bodies into errors', () => {
    expect(() => parseApiResponse('Clave incorrecta')).toThrow(/Clave incorrecta/)
    expect(() => parseApiResponse('{"error":"bad"}')).toThrow(/bad/)
    expect(parseApiResponse('{"paginacion":[{"total":0}]}')).toHaveProperty('paginacion')
  })
})

describe('mock backend', () => {
  it('rejects wrong credentials', () => {
    expect(mockResponse({ numagencia: '1', password: 'x' }, [{ type: 'paginacion', pos: 1, num: 1 }])).toHaveProperty('error')
  })

  it('paginates and filters', () => {
    const page = mockResponse({ numagencia: '1234', password: 'demo' }, [{ type: 'paginacion', pos: 21, num: 20, where: 'keyacci=2', order: 'precioalq asc' }])
    const { meta, items } = splitSection(page.paginacion)
    expect(meta.posicion).toBe(21)
    expect(items.every((p) => p.keyacci === 2)).toBe(true)
    expect(items.length).toBeLessThanOrEqual(20)
    expect(meta.total).toBeGreaterThan(0)
  })

  it('returns a detail sheet with photos', () => {
    const data = mockResponse({ numagencia: '1234', password: 'demo' }, [{ type: 'ficha', pos: 1, num: 1, where: 'cod_ofer=10001' }])
    const { items } = splitSection(data.ficha)
    expect(items[0].cod_ofer).toBe(10001)
    expect(items[0].fotos).toHaveLength(5)
  })
})

describe('client helpers', () => {
  it('builds where clauses and sanitises search text', () => {
    expect(buildWhere({ operation: 'all' })).toBe('')
    expect(buildWhere({ operation: 'rent', typeKey: '3', search: "ALM'; drop" })).toBe("keyacci=2 and key_tipo=3 and (ref like '%ALM drop%' or ciudad like '%ALM drop%')")
  })

  it('formats prices for sale and rent', () => {
    expect(priceOf({ keyacci: 1, precioinmo: 150000 })).toMatch(/150\.000/)
    expect(priceOf({ keyacci: 2, precioalq: 800 })).toMatch(/800.*\/mes/)
    expect(priceOf({ keyacci: 1, precioinmo: 0 })).toBe('A consultar')
    expect(isRent({ precioinmo: 0, precioalq: 500 })).toBe(true)
  })

  it('lists enabled features only', () => {
    expect(featuresOf({ ascensor: 1, terraza: '1', piscina_com: 0 })).toEqual(['Ascensor', 'Terraza'])
  })
})

describe('what apiweb means when it refuses', () => {
  it('turns a fragment of PHP into something a person can act on', async () => {
    const { describeRefusal } = await import('../server/inmovilla.js')
    expect(describeRefusal('die("xIP NO VALIDADA - IP_RECIVED: 195.15.213.10 --- logsgenericos");')).toMatch(/autoriz/i)
    expect(describeRefusal('NECESITAMOS RECIBIR LA IP')).toMatch(/IP del visitante/i)
    expect(describeRefusal('die("ERROR VALIDACION AGENCIAx");')).toMatch(/número de agencia/i)
    // Anything it has not seen before is left alone: a wrong guess is worse than the raw text.
    expect(describeRefusal('algo completamente distinto')).toBe('')
    expect(describeRefusal('')).toBe('')
    expect(describeRefusal(null)).toBe('')
  })
})

describe('Inmovilla enumerations', () => {
  it('are kept once fetched — the API allows two calls a minute', async () => {
    // Types, towns and zones are Inmovilla's own reference data: they change when a town is
    // added, which is almost never, and refetching on a timer spends a scarce allowance on an
    // answer that has not moved. Verified live: `408 · sólo es posible realizar 2 cada 1 minuto`.
    const source = readFileSync('src/stores/enums.js', 'utf8')
    expect(source).not.toMatch(/TTL_MS|Date\.now\(\) - ts </)
    expect(source).toMatch(/fresh\(ts\) \{\s*\n?\s*return Boolean\(ts\)/)
    expect(source).toMatch(/refresh\(\) \{/)
  })
})
