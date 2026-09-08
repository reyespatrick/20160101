import { defineStore } from 'pinia'
import { buildWhere, fetchProperties, fetchProperty, ORDER_OPTIONS } from '../api/inmovilla'
import { useAuthStore } from './auth'

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
          this.error = 'La agencia aún no tiene configuradas las claves de Inmovilla'
        } else if (err.status === 401 && !err.code) {
          this.error = 'Inmovilla rechazó las claves de la agencia; avisa al administrador'
        } else if (err.code === 'session') {
          this.error = ''
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
