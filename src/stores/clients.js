import { defineStore } from 'pinia'
import { fromInmovillaClient } from '../api/inmovillaMapping'
import { createClient, deleteClient, listClients, updateClient } from '../api/inmovillaRest'
import { clientsDb } from '../db/clientsDb'
import { emptyClient, matchesClient } from '../models/client'
import { mergeRemoteList, pendingRecords, planFor } from '../sync/outbox'
import { useAuthStore } from './auth'

/**
 * Clients live in Inmovilla. This store keeps an offline cache of them in IndexedDB
 * plus an outbox of local edits, replayed against the REST API when online.
 */
export const useClientsStore = defineStore('clients', {
  state: () => ({
    items: [],
    loaded: false,
    loading: false,
    syncing: false,
    lastSyncAt: 0,
    syncError: '',
    needsLogin: false,
    query: '',
    statusFilter: '',
  }),
  getters: {
    active: (s) => s.items.filter((c) => !c.deleted),
    pendingCount: (s) => s.items.filter((c) => c.dirty).length,
    filtered(s) {
      return this.active
        .filter((c) => (!s.statusFilter || c.status === s.statusFilter) && matchesClient(c, s.query))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    byId: (s) => (id) => s.items.find((c) => c.id === String(id) && !c.deleted) || null,
  },
  actions: {
    agency() {
      return useAuthStore().numagencia
    },
    async load() {
      const agency = this.agency()
      if (!agency) return
      this.loading = true
      try {
        this.items = await clientsDb.all(agency)
        this.lastSyncAt = (await clientsDb.getMeta(`lastSync:${agency}`)) || 0
        this.loaded = true
      } catch (err) {
        this.syncError = err.message || 'No se pudo abrir la base de datos local'
      } finally {
        this.loading = false
      }
    },
    async ensureLoaded() {
      if (!this.loaded) await this.load()
    },
    async get(id) {
      await this.ensureLoaded()
      return this.byId(id)
    },

    /** Create or update locally, then push in the background. */
    async save(client) {
      const record = { ...emptyClient(), ...client, id: client.id, updatedAt: Date.now(), deleted: false, syncError: '' }
      if (!record.createdAt) record.createdAt = record.updatedAt
      const saved = await clientsDb.putLocal(this.agency(), record)
      this.upsertLocal(saved)
      this.sync()
      return saved
    },
    async remove(id) {
      const existing = this.items.find((c) => c.id === id)
      if (!existing) return
      if (!existing.remoteId) {
        await clientsDb.remove(this.agency(), id)
        this.items = this.items.filter((c) => c.id !== id)
        return
      }
      const saved = await clientsDb.putLocal(this.agency(), { ...existing, deleted: true, updatedAt: Date.now() })
      this.upsertLocal(saved)
      this.sync()
    },
    upsertLocal(client) {
      const i = this.items.findIndex((c) => c.id === client.id)
      if (i >= 0) this.items.splice(i, 1, client)
      else this.items.push(client)
    },

    /** Replay the outbox against Inmovilla, then refresh the cache from Inmovilla. */
    async sync() {
      const auth = useAuthStore()
      const agency = auth.numagencia
      if (!agency || !auth.restToken || this.syncing) return false
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
      this.syncing = true
      this.syncError = ''
      try {
        await this.ensureLoaded()
        for (const record of pendingRecords(this.items)) {
          try {
            await this.pushOne(auth.restToken, agency, record)
          } catch (err) {
            if (err.status === 0) return false // offline: keep everything for later
            if (err.status === 401 || err.status === 403) {
              this.needsLogin = true
              return false
            }
            const failed = { ...record, syncError: err.message || 'Inmovilla rechazó el cambio' }
            await clientsDb.putLocal(agency, failed)
            this.upsertLocal({ ...failed, dirty: true })
          }
        }
        const remote = listMapped(await listClients(auth.restToken))
        const merged = mergeRemoteList(await clientsDb.all(agency), remote)
        await clientsDb.replaceAll(agency, merged)
        this.items = merged
        this.lastSyncAt = Date.now()
        await clientsDb.setMeta(`lastSync:${agency}`, this.lastSyncAt)
        this.needsLogin = false
        return true
      } catch (err) {
        if (err.status === 401 || err.status === 403) this.needsLogin = true
        else if (err.status !== 0) this.syncError = err.message || 'Error al sincronizar con Inmovilla'
        return false
      } finally {
        this.syncing = false
      }
    },

    async pushOne(token, agency, record) {
      const { dirty, syncError, ...payload } = record
      switch (planFor(record)) {
        case 'create': {
          const remoteId = await createClient(token, payload)
          await clientsDb.markSynced(agency, record.id, { remoteId: remoteId || null })
          break
        }
        case 'update':
          await updateClient(token, record.remoteId, payload)
          await clientsDb.markSynced(agency, record.id, {})
          break
        case 'delete':
          await deleteClient(token, record.remoteId)
          await clientsDb.remove(agency, record.id)
          break
        default:
          await clientsDb.remove(agency, record.id)
      }
    },

    reset() {
      this.$reset()
    },
  },
})

function listMapped(rawList) {
  return rawList.map(fromInmovillaClient).filter(Boolean)
}
