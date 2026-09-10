/**
 * The catching-up an agent could not do in the field: matching a contact against Inmovilla when
 * the network finally allows it, and deciding what to keep when the two versions disagree.
 */
import { describe, expect, it } from 'vitest'
import { applyChoice, differingFields } from '../src/utils/merge.js'
import { hasFastNetwork } from '../src/utils/network.js'
import { isNetworkError } from '../src/composables/useOnlineRetry.js'
import { compareToBase, officeMoved, same, snapshotOfLocal, snapshotOfRemote } from '../src/models/remote.js'

const FIELDS = [
  { key: 'name', label: 'Prénom' },
  { key: 'surname', label: 'Nom' },
  { key: 'email', label: 'Email' },
]

describe('two versions of the same person', () => {
  it('only asks about what actually differs', () => {
    const mine = { name: 'Ana', surname: 'García', email: '' }
    const theirs = { name: ' Ana ', surname: 'Garcia Ruiz', email: 'ana@ejemplo.es' }
    const rows = differingFields(mine, theirs, FIELDS)
    // " Ana " and "Ana" are the same person; nobody should have to arbitrate that.
    expect(rows.map((r) => r.key)).toEqual(['surname', 'email'])
    expect(rows[1]).toMatchObject({ mine: '', theirs: 'ana@ejemplo.es' })
  })

  it('reads a field that is spelled differently on the other side', () => {
    const rows = differingFields({ ownerName: 'Luis' }, { nombre: 'Luís' }, [{ key: 'ownerName', label: 'Prénom', read: (c) => c.nombre }])
    expect(rows).toEqual([{ key: 'ownerName', label: 'Prénom', mine: 'Luis', theirs: 'Luís' }])
  })

  it('says nothing when the two agree', () => {
    expect(differingFields({ name: 'Ana' }, { name: 'Ana' }, FIELDS.slice(0, 1))).toEqual([])
  })

  it('takes only what was chosen, and reports how much', () => {
    const base = { name: 'Ana', surname: 'García', email: '', checkedAt: 7 }
    const rows = differingFields(base, { name: 'Ana', surname: 'Garcia Ruiz', email: 'ana@ejemplo.es' }, FIELDS)
    const { next, taken } = applyChoice(base, rows, { surname: 'mine', email: 'theirs' })
    expect(taken).toBe(1)
    expect(next).toMatchObject({ surname: 'García', email: 'ana@ejemplo.es', checkedAt: 7 })
    // Choosing nothing changes nothing: the original is returned untouched.
    expect(applyChoice(base, rows, {})).toMatchObject({ taken: 0, next: base })
  })
})

describe('is the connection worth waiting on', () => {
  const withNavigator = (nav, fn) => {
    const real = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true })
    try {
      return fn()
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: real, configurable: true })
    }
  }

  it('trusts the browser when it says, and assumes yes when it cannot', () => {
    expect(withNavigator({ onLine: false }, hasFastNetwork)).toBe(false)
    // No `connection` at all: every iPhone. Refusing to try there would be worse than trying.
    expect(withNavigator({ onLine: true }, hasFastNetwork)).toBe(true)
    expect(withNavigator({ onLine: true, connection: { effectiveType: '4g' } }, hasFastNetwork)).toBe(true)
    expect(withNavigator({ onLine: true, connection: { effectiveType: '3g' } }, hasFastNetwork)).toBe(false)
    expect(withNavigator({ onLine: true, connection: { effectiveType: 'slow-2g' } }, hasFastNetwork)).toBe(false)
    // Data saver is a request, not a guess.
    expect(withNavigator({ onLine: true, connection: { effectiveType: '4g', saveData: true } }, hasFastNetwork)).toBe(false)
  })

  it('tells a missing network from a refused request', () => {
    expect(isNetworkError({ status: 0, message: 'Sin conexión con el servidor' })).toBe(true)
    expect(isNetworkError({ status: 504 })).toBe(true)
    expect(isNetworkError({ status: 403, message: 'Tu cuenta es de solo lectura' })).toBe(false)
    expect(isNetworkError({ status: 404, message: 'No encontrado' })).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })
})

/**
 * Whose version is right, when the phone and the office both changed the same listing. Not a
 * question of clocks: of who moved since the two sides last agreed.
 */
describe('the office moved too', () => {
  const base = { price: 185000, priceRent: 0, operation: 1, typeKey: 5, bedrooms: 3, bathrooms: 1, builtArea: 92, plotArea: 0 }
  const rowsFor = (remote, local) => compareToBase({ base, remote: { ...base, ...remote }, local: { ...base, ...local } })

  it('says nothing when only the phone moved', () => {
    const rows = rowsFor({}, { price: 179000 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'price', prefer: 'mine', remoteMoved: false, localMoved: true })
    expect(officeMoved(rows)).toBe(false)
  })

  it('takes the office version when only the office moved', () => {
    const rows = rowsFor({ price: 179000 }, {})
    expect(rows[0]).toMatchObject({ key: 'price', prefer: 'theirs', remoteMoved: true, localMoved: false })
    expect(officeMoved(rows)).toBe(true)
  })

  it('asks only where both moved to different values', () => {
    const rows = rowsFor({ price: 179000, bedrooms: 4 }, { price: 175000, bedrooms: 4 })
    // Both raised the bedroom count to 4: they agree, so there is nothing to arbitrate.
    expect(rows.map((r) => r.key)).toEqual(['price'])
    expect(rows[0]).toMatchObject({ mine: 175000, theirs: 179000, prefer: 'mine', remoteMoved: true, localMoved: true })
  })

  it('is not fooled by how the two sides write nothing', () => {
    // apiweb answers 0 for an empty rent and '' for an empty plot; the phone holds null.
    expect(same(0, null)).toBe(true)
    expect(same('', null)).toBe(true)
    expect(same('185000', 185000)).toBe(true)
    expect(same(0, 1)).toBe(false)
    expect(rowsFor({ priceRent: '0', plotArea: '' }, { priceRent: null, plotArea: null })).toEqual([])
  })

  it('reads a snapshot from either side into the same shape', () => {
    const fromApiweb = snapshotOfRemote({ precioinmo: 185000, precioalq: 0, keyacci: 1, key_tipo: 5, habitaciones: 3, banyos: 1, m_cons: 92, m_parcela: 0, fechaact: '2026-09-08 10:00:00' })
    expect(fromApiweb).toEqual(base)
    expect(snapshotOfLocal({ ...base, ref: 'APP-1', notes: 'ignored' })).toEqual(base)
    expect(snapshotOfRemote(null)).toBe(null)
  })
})
