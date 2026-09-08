import { defineStore } from 'pinia'
import { parseCiudades, parseTipos, parseZonas } from '../api/inmovillaMapping'
import { enumsCiudades, enumsTipos, enumsTiposSeguimiento, enumsZonas, isRateLimited } from '../api/inmovillaRest'
import { normalizeText } from '../models/client'
import { useAuthStore } from './auth'

/**
 * Inmovilla enums (types, cities, zones…) cached on the device.
 * The enums endpoint allows 2 calls per minute, so calls are spaced 31 s apart
 * and results are kept for a week in localStorage.
 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000
const MIN_GAP_MS = 31_000
const storageKey = (agency) => `immoba.enums.${agency}`

let lastCallAt = 0
let queue = Promise.resolve()
function throttled(fn) {
  const run = async () => {
    const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now())
    if (wait) await new Promise((r) => setTimeout(r, wait))
    lastCallAt = Date.now()
    try {
      return await fn()
    } catch (err) {
      if (isRateLimited(err)) {
        await new Promise((r) => setTimeout(r, 35_000))
        lastCallAt = Date.now()
        return fn()
      }
      throw err
    }
  }
  const p = queue.then(run, run)
  queue = p.catch(() => {})
  return p
}

export const useEnumsStore = defineStore('enums', {
  state: () => ({
    tipos: {}, // name -> [{ value, label }]
    ciudades: [], // [{ key_loca, ciudad, provincia }]
    zonas: {}, // key_loca -> [{ key_zona, zona }]
    tiposSeguimiento: [], // [{ value, label }] agency-specific follow-up types
    fetchedAt: { tipos: 0, ciudades: 0, tiposSeguimiento: 0 },
    zonasFetchedAt: {},
    loading: { tipos: false, ciudades: false, zonas: false, tiposSeguimiento: false },
    error: '',
    restored: false,
  }),
  getters: {
    options: (s) => (name) => s.tipos[name] || [],
    typeOptions() {
      return this.options('key_tipo')
    },
    label: (s) => (name, value) => s.tipos[name]?.find((o) => String(o.value) === String(value))?.label || '',
    cityByKey: (s) => (key) => s.ciudades.find((c) => String(c.key_loca) === String(key)) || null,
    searchCities: (s) => (q, limit = 15) => {
      const n = normalizeText(q).trim()
      if (!n) return []
      const starts = []
      const contains = []
      for (const c of s.ciudades) {
        const name = normalizeText(c.ciudad)
        if (name.startsWith(n)) starts.push(c)
        else if (name.includes(n)) contains.push(c)
        if (starts.length >= limit) break
      }
      return [...starts, ...contains].slice(0, limit)
    },
    zoneOptions: (s) => (keyLoca) => s.zonas[String(keyLoca)] || [],
  },
  actions: {
    restore() {
      if (this.restored) return
      this.restored = true
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey(useAuthStore().numagencia)) || 'null')
        if (saved) {
          this.tipos = saved.tipos || {}
          this.ciudades = saved.ciudades || []
          this.zonas = saved.zonas || {}
          this.tiposSeguimiento = saved.tiposSeguimiento || []
          this.fetchedAt = { tipos: 0, ciudades: 0, tiposSeguimiento: 0, ...(saved.fetchedAt || {}) }
          this.zonasFetchedAt = saved.zonasFetchedAt || {}
        }
      } catch {
        /* ignore */
      }
    },
    persist() {
      try {
        localStorage.setItem(
          storageKey(useAuthStore().numagencia),
          JSON.stringify({ tipos: this.tipos, ciudades: this.ciudades, zonas: this.zonas, tiposSeguimiento: this.tiposSeguimiento, fetchedAt: this.fetchedAt, zonasFetchedAt: this.zonasFetchedAt }),
        )
      } catch {
        /* quota */
      }
    },
    fresh(ts) {
      return ts && Date.now() - ts < TTL_MS
    },
    async ensureTipos() {
      this.restore()
      if (this.fresh(this.fetchedAt.tipos) && this.tipos.key_tipo?.length) return
      const auth = useAuthStore()
      if (!auth.hasKeys || navigator.onLine === false) return
      this.loading.tipos = true
      try {
        let tipos = parseTipos(await throttled(() => enumsTipos()))
        if (!tipos.key_tipo?.length) {
          // key_tipo may be served separately
          const only = parseTipos(await throttled(() => enumsTipos('key_tipo')))
          tipos = { ...tipos, ...only }
        }
        this.tipos = tipos
        this.fetchedAt.tipos = Date.now()
        this.persist()
      } catch (err) {
        this.error = err.message
      } finally {
        this.loading.tipos = false
      }
    },
    async ensureCiudades() {
      this.restore()
      if (this.fresh(this.fetchedAt.ciudades) && this.ciudades.length) return
      const auth = useAuthStore()
      if (!auth.hasKeys || navigator.onLine === false) return
      this.loading.ciudades = true
      try {
        this.ciudades = parseCiudades(await throttled(() => enumsCiudades()))
        this.fetchedAt.ciudades = Date.now()
        this.persist()
      } catch (err) {
        this.error = err.message
      } finally {
        this.loading.ciudades = false
      }
    },
    async ensureZonas(keyLoca) {
      this.restore()
      const key = String(keyLoca)
      if (!keyLoca || (this.fresh(this.zonasFetchedAt[key]) && this.zonas[key])) return
      const auth = useAuthStore()
      if (!auth.hasKeys || navigator.onLine === false) return
      this.loading.zonas = true
      try {
        const parsed = parseZonas(await throttled(() => enumsZonas(key)))
        this.zonas[key] = parsed[key] || Object.values(parsed)[0] || []
        this.zonasFetchedAt[key] = Date.now()
        this.persist()
      } catch (err) {
        this.error = err.message
      } finally {
        this.loading.zonas = false
      }
    },
    async ensureTiposSeguimiento() {
      this.restore()
      if (this.fresh(this.fetchedAt.tiposSeguimiento) && this.tiposSeguimiento.length) return
      const auth = useAuthStore()
      if (!auth.hasKeys || navigator.onLine === false) return
      this.loading.tiposSeguimiento = true
      try {
        const body = await throttled(() => enumsTiposSeguimiento())
        this.tiposSeguimiento = (Array.isArray(body) ? body : []).map((o) => ({ value: o.valor, label: String(o.nombre) })).filter((o) => o.value !== undefined)
        this.fetchedAt.tiposSeguimiento = Date.now()
        this.persist()
      } catch (err) {
        this.error = err.message
      } finally {
        this.loading.tiposSeguimiento = false
      }
    },
    followUpTypeLabel(value) {
      return this.tiposSeguimiento.find((o) => String(o.value) === String(value))?.label || ''
    },
    /** Warm the reference lists right after login (calls are spaced to respect the 2/min limit). */
    warm() {
      this.ensureTipos()
        .then(() => this.ensureCiudades())
        .then(() => this.ensureTiposSeguimiento())
    },
    reset() {
      this.$reset()
    },
  },
})
