import { describe, expect, it } from 'vitest'
import { fromInmovillaFollowUp, fromInmovillaOwner, toInmovillaFollowUp, toInmovillaOwnerRecord } from '../src/api/inmovillaMapping.js'
import { bucketOf, emptyFollowUp, formatWhen, fromInmovillaDate, matchesFollowUp, toInmovillaDate, validateFollowUp } from '../src/models/followUp.js'
import { emptyOwner, validateOwner } from '../src/models/owner.js'
import { followUpToIcs, googleCalendarUrl } from '../src/utils/calendar.js'

const fu = (over = {}) => ({ ...emptyFollowUp(), id: 'f1', typeKey: 40, typeName: 'Llamada', subject: 'Llamar', remindAt: new Date(2026, 5, 25, 10, 0).getTime(), ...over })

describe('follow-up dates and buckets', () => {
  it('formats and parses Inmovilla dates in local time', () => {
    expect(toInmovillaDate(new Date(2026, 5, 25, 10, 5, 7).getTime())).toBe('2026-06-25 10:05:07')
    expect(fromInmovillaDate('2026-06-25 10:05:07')).toBe(new Date(2026, 5, 25, 10, 5, 7).getTime())
    expect(fromInmovillaDate(null)).toBeNull()
    expect(toInmovillaDate(null)).toBeUndefined()
  })
  it('buckets by day', () => {
    const now = new Date(2026, 8, 7, 12).getTime()
    expect(bucketOf(fu({ remindAt: new Date(2026, 8, 6, 23).getTime() }), now)).toBe('overdue')
    expect(bucketOf(fu({ remindAt: new Date(2026, 8, 7, 18).getTime() }), now)).toBe('today')
    expect(bucketOf(fu({ remindAt: new Date(2026, 8, 8, 9).getTime() }), now)).toBe('upcoming')
    expect(bucketOf(fu({ closed: true }), now)).toBe('closed')
    expect(formatWhen(new Date(2026, 8, 7, 18, 30).getTime(), now)).toMatch(/^Hoy · 18:30/)
    expect(formatWhen(new Date(2026, 8, 8, 9, 0).getTime(), now)).toMatch(/^Mañana/)
  })
  it('validates and searches', () => {
    expect(validateFollowUp(fu({ subject: '' }))).toHaveProperty('subject')
    expect(validateFollowUp(fu({ typeKey: null }))).toEqual({}) // type is optional (agency lists may not be cached offline)
    expect(validateFollowUp(fu({ closed: true, doneAt: null }))).toHaveProperty('doneAt')
    expect(validateFollowUp(fu())).toEqual({})
    expect(matchesFollowUp(fu({ propertyLabel: 'Ref. APP-1 · Ático en Alicante' }), 'atico')).toBe(true)
    expect(matchesFollowUp(fu(), 'visita')).toBe(false)
  })
})

describe('follow-up mapping', () => {
  it('maps to /seguimientos payloads (create and update)', () => {
    expect(toInmovillaFollowUp(fu({ propertyCodOfer: '5003', clientRemoteId: '5000', description: 'x' }))).toEqual({
      keyofe: 5003, keyprospecto: 5000, keytiposeg: 40, asunto: 'Llamar', descrip: 'x', fechaaviso: '2026-06-25 10:00:00', tareacerrada: 0,
    })
    const closed = toInmovillaFollowUp(fu({ remoteId: '77', closed: true, doneAt: new Date(2026, 5, 30, 11).getTime() }))
    expect(closed).toMatchObject({ codseg: 77, tareacerrada: 1, fechafin: '2026-06-30 11:00:00' })
  })
  it('maps back from Inmovilla', () => {
    const f = fromInmovillaFollowUp({ codseg: 12345, keyagente: 101, keyofe: 5288705, keyprospecto: 0, keytiposeg: 50, asunto: 'Visita', descrip: 'd', fechaaviso: '2026-06-25 10:00:00', fechafin: null, tareacerrada: 0, fechaalta: '2026-06-20 09:00:00' }, (k) => (k === 50 ? 'Email' : ''))
    expect(f).toMatchObject({ id: 'inmo-12345', remoteId: '12345', typeKey: 50, typeName: 'Email', subject: 'Visita', propertyCodOfer: '5288705', clientRemoteId: null, closed: false, agentKey: 101 })
    expect(f.remindAt).toBe(new Date(2026, 5, 25, 10).getTime())
    expect(fromInmovillaFollowUp({ asunto: 'sin codseg' })).toBeNull()
  })
})

describe('owner mapping', () => {
  it('maps full owner records both ways', () => {
    const out = toInmovillaOwnerRecord({ ...emptyOwner(), codOfer: '5003', name: 'Luis', mobile: '+34 600 111 222', phone3: '965 000 000', notes: 'llaves' })
    expect(out).toEqual({ cod_ofer: 5003, nombre: 'Luis', telefono2: 600111222, prefijotel2: 34, telefono3: 965000000, observacion: 'llaves' })
    expect(toInmovillaOwnerRecord({ ...emptyOwner(), remoteId: '9', name: 'Luis' }, { forUpdate: true })).toEqual({ cod_cli: 9, nombre: 'Luis' })
    const back = fromInmovillaOwner({ cod_cli: '13449756', nombre: 'Pedro', apellidos: 'Picapiedra', telefono1: '666554433', propiedades: [{ cod_ofer: '5288705', ref: '00633', disponible: true }, { cod_ofer: '5426130', ref: 'X', disponible: false }] })
    expect(back).toMatchObject({ id: 'inmo-13449756', remoteId: '13449756', name: 'Pedro', phone: '666554433' })
    expect(back.properties).toEqual([{ codOfer: '5288705', ref: '00633', available: true }, { codOfer: '5426130', ref: 'X', available: false }])
    expect(validateOwner({ ...emptyOwner(), name: '' })).toHaveProperty('name')
    expect(validateOwner({ ...emptyOwner(), name: 'A' })).toHaveProperty('codOfer')
    expect(validateOwner({ ...emptyOwner(), name: 'A', codOfer: '1' })).toEqual({})
  })
})

describe('calendar export', () => {
  it('renders a valid ICS with alarm and a Google Calendar link', () => {
    const ics = followUpToIcs(fu({ description: 'Línea 1\nLínea 2, con coma', propertyLabel: 'Ref. X' }))
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('SUMMARY:Llamada · Llamar')
    expect(ics).toContain('DESCRIPTION:Línea 1\\nLínea 2\\, con coma\\nPropiedad: Ref. X')
    expect(ics).toContain('TRIGGER:-PT15M')
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/)
    const url = new URL(googleCalendarUrl(fu()))
    expect(url.searchParams.get('text')).toBe('Llamada · Llamar')
    expect(url.searchParams.get('dates')).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/)
  })
})
