/**
 * Reverse geocoding: the two providers answer in very different shapes, and the listing form
 * needs the same five fields from either. These pin the mapping and the guard rails.
 */
import { describe, expect, it } from 'vitest'
import { fromCatastro, fromGoogle, fromNominatim, reverseGeocode, validCoordinates } from '../shared/geocode.js'

describe('coordinates', () => {
  it('accepts real positions and rejects nonsense', () => {
    expect(validCoordinates(38.345, -0.481)).toBe(true)
    expect(validCoordinates(0, 0)).toBe(true)
    expect(validCoordinates('38.3', '-0.4')).toBe(true)
    for (const bad of [[91, 0], [0, 181], [NaN, 0], [undefined, 2], ['abc', 1], [null, null]]) {
      expect(validCoordinates(bad[0], bad[1])).toBe(false)
    }
  })

  it('refuses to call a provider with bad coordinates', async () => {
    await expect(reverseGeocode({ lat: 999, lon: 0 })).rejects.toMatchObject({ status: 400 })
  })
})

describe('Google', () => {
  const payload = {
    status: 'OK',
    results: [{
      formatted_address: 'Carrer de Colón 12, 03001 Alicante, España',
      address_components: [
        { long_name: '12', types: ['street_number'] },
        { long_name: 'Carrer de Colón', types: ['route'] },
        { long_name: 'Alicante', types: ['locality', 'political'] },
        { long_name: 'Alicante', types: ['administrative_area_level_2'] },
        { long_name: '03001', types: ['postal_code'] },
      ],
    }],
  }

  it('picks out the fields the form has', () => {
    expect(fromGoogle(payload)).toMatchObject({
      number: '12', street: 'Carrer de Colón', postalCode: '03001', city: 'Alicante', province: 'Alicante', provider: 'google',
    })
  })

  it('falls back to postal_town when there is no locality', () => {
    const noLocality = { ...payload, results: [{ ...payload.results[0], address_components: [{ long_name: 'Elche', types: ['postal_town'] }] }] }
    expect(fromGoogle(noLocality).city).toBe('Elche')
  })

  it('returns null when there is nothing there', () => {
    expect(fromGoogle({ status: 'OK', results: [] })).toBeNull()
    expect(fromGoogle({})).toBeNull()
  })
})

describe('Nominatim', () => {
  it('maps its address keys, whichever the country uses for a town', () => {
    expect(fromNominatim({ display_name: 'Calle Mayor 3, Elche', address: { house_number: '3', road: 'Calle Mayor', postcode: '03203', town: 'Elche', province: 'Alicante' } }))
      .toMatchObject({ number: '3', street: 'Calle Mayor', postalCode: '03203', city: 'Elche', province: 'Alicante', provider: 'nominatim' })
    expect(fromNominatim({ address: { village: 'Altea' } }).city).toBe('Altea')
    expect(fromNominatim({ address: { municipality: 'Dénia' } }).city).toBe('Dénia')
  })

  it('never invents a field it did not get', () => {
    expect(fromNominatim({ address: { city: 'Alicante' } })).toMatchObject({ number: '', street: '', postalCode: '', province: '' })
    expect(fromNominatim({})).toBeNull()
  })
})

describe('Spanish cadastre', () => {
  it('joins the two halves into the referencia catastral and keeps the address line', () => {
    // Shape observed against the live service for Alicante's town hall, 10 Sept 2026.
    const payload = {
      Consulta_RCCOORResult: {
        control: { cucoor: 1 },
        coordenadas: { coord: [{ pc: { pc1: '0273103', pc2: 'YH2407C' }, ldt: 'PZ AJUNTAMENT 1 ALICANTE/ALACANT (ALICANTE)' }] },
      },
    }
    expect(fromCatastro(payload)).toEqual({ reference: '0273103YH2407C', label: 'PZ AJUNTAMENT 1 ALICANTE/ALACANT (ALICANTE)' })
  })

  it('accepts coord as a bare object as well as an array', () => {
    const one = { Consulta_RCCOORResult: { coordenadas: { coord: { pc: { pc1: 'AAA', pc2: 'BBB' }, ldt: ' X ' } } } }
    expect(fromCatastro(one)).toEqual({ reference: 'AAABBB', label: 'X' })
  })

  it('returns null where there is no plot', () => {
    // Live answer for a point at sea.
    expect(fromCatastro({ Consulta_RCCOORResult: { control: { cuerr: 1 }, lerr: [{ cod: '16', des: 'PARA ESAS COORDENADAS NO HAY REFERENCIA DISPONIBLE' }] } })).toBeNull()
    expect(fromCatastro({ Consulta_RCCOORResult: { coordenadas: { coord: [{ pc: { pc1: '0273103' } }] } } })).toBeNull()
    expect(fromCatastro({})).toBeNull()
  })
})

describe('owner completeness', () => {
  it('holds an owner back until Inmovilla can accept it', async () => {
    const { ownerIsComplete } = await import('../src/stores/localProperties.js')
    // POST /propietarios/ requires cod_ofer, nombre and apellidos.
    expect(ownerIsComplete({ ownerPhone: '600111222' })).toBe(false)
    expect(ownerIsComplete({ ownerName: 'Carmen' })).toBe(false)
    expect(ownerIsComplete({ ownerName: 'Carmen', ownerSurname: '  ' })).toBe(false)
    expect(ownerIsComplete({ ownerName: 'Carmen', ownerSurname: 'Ortiz' })).toBe(true)
    expect(ownerIsComplete(null)).toBe(false)
  })
})

/**
 * The address sheet asks the cadastre about a typed address rather than about coordinates, so
 * these pin the two things that made the live calls fail: the street type the register insists
 * on, and the fact that it answers in two unannounced shapes.
 */
describe('cadastre by address', () => {
  it('reads the street type out of what the agent typed', async () => {
    const { splitStreet } = await import('../shared/geocode.js')
    expect(splitStreet('Avenida Ricardo Soriano')).toEqual({ sigla: 'AV', name: 'RICARDO SORIANO' })
    expect(splitStreet('Calle Marqués de Larios')).toEqual({ sigla: 'CL', name: 'MARQUES DE LARIOS' })
    expect(splitStreet('Plaza de la Constitución')).toEqual({ sigla: 'PZ', name: 'DE LA CONSTITUCION' })
    expect(splitStreet('Camino de Ronda')).toEqual({ sigla: 'CM', name: 'DE RONDA' })
    // No type at all: the register's commonest one, and the name kept whole.
    expect(splitStreet('Los Naranjos')).toEqual({ sigla: 'CL', name: 'LOS NARANJOS' })
  })

  it('reads the plot out of either answer shape', async () => {
    const { fromDnploc } = await import('../shared/geocode.js')
    // One property at that number: the register answers `bico`.
    const single = {
      consulta_dnplocResult: {
        control: { cudnp: 1 },
        bico: {
          bi: {
            idbi: { rc: { pc1: '3148206', pc2: 'UF7634N', car: '0001' } },
            dt: { locs: { lous: { lourb: { dir: { tv: 'CL', nv: 'MARQUES DE LARIOS', pnp: '5' }, dp: '29015' } } } },
            ldt: 'CL MARQUES DE LARIOS 5 29015 MALAGA (MÁLAGA)',
          },
        },
      },
    }
    expect(fromDnploc(single)).toMatchObject({ reference: '3148206UF7634N', postalCode: '29015', street: 'CL MARQUES DE LARIOS', number: '5' })

    // A block of flats: every unit is listed under `lrcdnp`, all on the same plot.
    const many = {
      consulta_dnplocResult: {
        control: { cudnp: 234 },
        lrcdnp: {
          rcdnp: [
            { rc: { pc1: '1024212', pc2: 'UF3412S', car: '0001' }, dt: { locs: { lous: { lourb: { dir: { tv: 'AV', nv: 'RICARDO SORIANO', pnp: '20', td: 'ED RICARDO SORIANO 20' }, dp: '29601' } } } } },
            { rc: { pc1: '1024212', pc2: 'UF3412S', car: '0002' }, dt: {} },
          ],
        },
      },
    }
    expect(fromDnploc(many)).toMatchObject({ reference: '1024212UF3412S', label: 'ED RICARDO SORIANO 20', postalCode: '29601' })

    expect(fromDnploc({ consulta_dnplocResult: { control: { cuerr: 1 }, lerr: [{ cod: '5' }] } })).toBe(null)
    expect(fromDnploc(null)).toBe(null)
  })

  it('needs the whole address before it asks anything', async () => {
    const { cadastralByAddress } = await import('../shared/geocode.js')
    expect(await cadastralByAddress({ province: 'MALAGA', municipality: 'MARBELLA', street: '', number: '20' })).toBe(null)
    expect(await cadastralByAddress({ province: 'MALAGA', municipality: '', street: 'Av Ricardo Soriano', number: '20' })).toBe(null)
    expect(await cadastralByAddress({ province: 'MALAGA', municipality: 'MARBELLA', street: 'Av Ricardo Soriano', number: '' })).toBe(null)
  })
})

/** The town list the address sheet offers: generated from the register, matched loosely. */
describe('Andalusia', () => {
  it('matches what a map provider calls a town against the register', async () => {
    const { DEFAULT_PROVINCE, findMunicipality, municipalitiesOf } = await import('../src/data/andalucia.js')
    expect(DEFAULT_PROVINCE).toBe('29')
    expect(municipalitiesOf('29')).toHaveLength(103)
    expect(findMunicipality('Marbella', 'Málaga')).toMatchObject({ province: '29', municipality: { c: 'MARBELLA', l: 'Marbella' } })
    // Accents and hyphens differ between the provider and the register; both are flattened.
    expect(findMunicipality('Vélez-Málaga', '')).toMatchObject({ province: '29' })
    expect(findMunicipality('Alcaucín', 'MALAGA')).toMatchObject({ municipality: { c: 'ALCAUCIN' } })
    // Outside Andalusia the draft keeps the name it was given, so no match is the right answer.
    expect(findMunicipality('Versoix', 'Genève')).toBe(null)
    expect(findMunicipality('', 'Málaga')).toBe(null)
  })
})
