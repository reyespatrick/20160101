import { defineStore } from 'pinia'
import { requestEstimate } from '../api/estimate'
import { useSettingsStore } from './settings'

/** Last valuation per property, kept on the device so the page opens instantly (and offline). */
const STORAGE_KEY = 'immoba.estimates'
const KEEP = 40

function read() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export const useEstimatesStore = defineStore('estimates', {
  state: () => ({ byKey: read(), loading: {}, error: {} }),
  getters: {
    get: (s) => (key) => s.byKey[key] || null,
    isLoading: (s) => (key) => Boolean(s.loading[key]),
    errorOf: (s) => (key) => s.error[key] || '',
  },
  actions: {
    persist() {
      const entries = Object.entries(this.byKey)
        .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
        .slice(0, KEEP)
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
      } catch {
        /* quota */
      }
    },
    async estimate(input) {
      const key = input.key
      this.loading[key] = true
      this.error[key] = ''
      try {
        const result = await requestEstimate(input, useSettingsStore().locale)
        this.byKey[key] = result
        this.persist()
        return result
      } catch (err) {
        this.error[key] = err.message || 'La valoración ha fallado'
        throw err
      } finally {
        this.loading[key] = false
      }
    },
    forget(key) {
      delete this.byKey[key]
      this.persist()
    },
  },
})
