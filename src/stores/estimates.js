import { defineStore } from 'pinia'
import { requestEstimate } from '../api/estimate'
import { estimatesDb } from '../db/estimatesDb'
import { useAuthStore } from './auth'
import { useSettingsStore } from './settings'

/** Where valuations used to live; read once, then moved into the database beside the listings. */
const LEGACY_KEY = 'immoba.estimates'

/**
 * What would change the answer if it changed. A valuation of a 92 m² flat at 185 000 € says
 * nothing about the same flat at 240 000 €, so the stored one is marked out of date — but never
 * thrown away, because a superseded valuation is still what the agent quoted last week.
 */
export function fingerprint(input = {}) {
  const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
  return {
    operation: n(input.operation),
    typeKey: n(input.typeKey),
    price: n(input.price),
    builtArea: n(input.builtArea),
    usableArea: n(input.usableArea),
    plotArea: n(input.plotArea),
    bedrooms: n(input.bedrooms),
    bathrooms: n(input.bathrooms),
    yearBuilt: n(input.yearBuilt),
    city: String(input.city || ''),
    zone: String(input.zone || ''),
    condition: String(input.condition || ''),
    energy: String(input.energy || ''),
  }
}

export function sameFingerprint(a, b) {
  if (!a || !b) return true // nothing to compare against: do not cry wolf
  return Object.keys(fingerprint({})).every((k) => String(a[k] ?? '') === String(b[k] ?? ''))
}

export const useEstimatesStore = defineStore('estimates', {
  state: () => ({ byKey: {}, loading: {}, error: {}, ready: null }),
  getters: {
    get: (s) => (key) => s.byKey[key] || null,
    isLoading: (s) => (key) => Boolean(s.loading[key]),
    errorOf: (s) => (key) => s.error[key] || '',
    /** A stored valuation whose listing has changed underneath it. */
    isStale: (s) => (key, input) => {
      const stored = s.byKey[key]
      return Boolean(stored && input && !sameFingerprint(stored.inputs, fingerprint(input)))
    },
  },
  actions: {
    agency() {
      return useAuthStore().numagencia
    },

    /** Reads what the device already holds, and adopts anything left in the old browser store. */
    ensureLoaded() {
      if (this.ready) return this.ready
      this.ready = (async () => {
        const agency = this.agency()
        if (!agency) return
        try {
          for (const rec of await estimatesDb.all(agency)) this.byKey[rec.id] = rec
        } catch {
          /* no IndexedDB: the store simply starts empty */
        }
        await this.adoptLegacy(agency)
      })()
      return this.ready
    },

    async adoptLegacy(agency) {
      let legacy
      try {
        legacy = JSON.parse(window.localStorage.getItem(LEGACY_KEY) || 'null')
      } catch {
        return
      }
      if (!legacy || typeof legacy !== 'object') return
      for (const [key, value] of Object.entries(legacy)) {
        if (this.byKey[key] || !value) continue
        const record = { id: key, ...value, inputs: value.inputs || null }
        this.byKey[key] = record
        await estimatesDb.putClean(agency, [record]).catch(() => {})
      }
      try {
        window.localStorage.removeItem(LEGACY_KEY)
      } catch {
        /* nothing to clean up */
      }
    },

    async estimate(input) {
      const key = input.key
      this.loading[key] = true
      this.error[key] = ''
      try {
        const result = await requestEstimate(input, useSettingsStore().locale)
        const record = { id: key, ...result, inputs: fingerprint(input) }
        this.byKey[key] = record
        await estimatesDb.putClean(this.agency(), [record]).catch(() => {})
        return record
      } catch (err) {
        this.error[key] = err.message || 'La valoración ha fallado'
        throw err
      } finally {
        this.loading[key] = false
      }
    },

    async forget(key) {
      delete this.byKey[key]
      await estimatesDb.remove(this.agency(), key).catch(() => {})
    },
  },
})
