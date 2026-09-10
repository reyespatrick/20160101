import { defineStore } from 'pinia'
import { buildWhere, fetchProperties, fetchProperty, ORDER_OPTIONS } from '../api/inmovilla'
import { useAuthStore } from './auth'
import { isNetworkError } from '../composables/useOnlineRetry'

const CACHE_KEY = 'immoba.properties.cache'
const PAGE_SIZE = 20

function readCache() {
  try {
    return JSON.parse(window.localStorage.getItem(CACHE_KEY) || 'null')
  } catch {
    return null
  }
}

export const usePropertiesStore = defineStore('properties', {
  state: () => ({
    items: [],
    total: 0,
    page: 0,
    types: [],
    loading: false,
    loadingMore: false,
    error: '',
    fromCache: false,
    offline: false, // the load failed for want of a network, not for a reason
    needsApiweb: false, // the listing needs the apiweb key, which is issued separately
    filters: { search: '', operation: 'all', typeKey: '', order: ORDER_OPTIONS[0].value },
    details: {}, // cod_ofer -> ficha
  }),
  getters: {
    hasMore: (s) => s.items.length < s.total,
    where: (s) => buildWhere(s.filters),
  },
  actions: {
    setFilters(patch) {
      this.filters = { ...this.filters, ...patch }
      return this.load()
    },
    async load() {
      const auth = useAuthStore()
      this.loading = true
      this.error = ''
      this.offline = false
      this.needsApiweb = false
      try {
        const { items, meta, types } = await fetchProperties({
          page: 1,
          pageSize: PAGE_SIZE,
          where: this.where,
          order: this.filters.order,
        })
        this.items = items
        this.total = meta.total
        this.page = 1
        this.fromCache = false
        if (types.length) this.types = types
        try {
          window.localStorage.setItem(CACHE_KEY, JSON.stringify({ items, total: meta.total, types: this.types, filters: this.filters, at: Date.now() }))
        } catch {
          /* ignore quota errors */
        }
      } catch (err) {
        if (err.code === 'keys') {
          this.error = err.message || 'La agencia no tiene configurada la clave web de Inmovilla'
          this.needsApiweb = true
        } else if (err.status === 401 && !err.code) {
          this.error = 'Inmovilla rechazó las claves de la agencia; avisa al administrador'
        } else if (err.code === 'session') {
          this.error = ''
        } else if (isNetworkError(err)) {
          // Nothing is wrong with the listing, only with the connection: say that, keep whatever
          // was last seen, and let the screen ask again when the network comes back.
          this.offline = true
          const cached = readCache()
          if (cached && !this.items.length) {
            this.items = cached.items
            this.total = cached.total
            this.types = cached.types || []
            this.fromCache = true
          }
        } else {
          this.error = err.message || 'No se pudieron cargar las propiedades'
          const cached = readCache()
          if (cached && !this.items.length) {
            this.items = cached.items
            this.total = cached.total
            this.types = cached.types || []
            this.fromCache = true
          }
        }
      } finally {
        this.loading = false
      }
    },
    async loadMore() {
      if (this.loadingMore || !this.hasMore || this.fromCache) return
      const auth = useAuthStore()
      this.loadingMore = true
      try {
        const { items, meta } = await fetchProperties({
          page: this.page + 1,
          pageSize: PAGE_SIZE,
          where: this.where,
          order: this.filters.order,
        })
        const known = new Set(this.items.map((p) => String(p.cod_ofer)))
        this.items.push(...items.filter((p) => !known.has(String(p.cod_ofer))))
        this.total = meta.total
        this.page += 1
      } catch (err) {
        this.error = err.message || 'No se pudieron cargar más propiedades'
      } finally {
        this.loadingMore = false
      }
    },
    async loadDetail(codOfer) {
      const key = String(codOfer)
      if (this.details[key]) return this.details[key]
      const auth = useAuthStore()
      const detail = await fetchProperty(codOfer)
      if (detail) this.details[key] = detail
      return detail
    },
    summaryFor(codOfer) {
      return this.items.find((p) => String(p.cod_ofer) === String(codOfer)) || null
    },
    reset() {
      this.$reset()
    },
  },
})
