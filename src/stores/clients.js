import { defineStore } from 'pinia'
import { syncClients } from '../api/clients'
import { clientsDb } from '../db/clientsDb'
import { emptyClient, matchesClient } from '../models/client'
import { applyRemoteChanges, pendingChanges } from '../sync/merge'
import { useAuthStore } from './auth'

/**
 * Offline-first clients store.
 *
 * - Every read/write goes to IndexedDB first, so the UI works with no network.
 * - Edits are flagged `dirty` and pushed by sync(); the server answers with
 *   everything changed since our last sync (other devices' edits included).
 * - sync() is triggered after each edit, when the app comes back online and
 *   when the clients screen is opened. Failures are silent: data stays local.
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
      const list = this.active.filter((c) => (!s.statusFilter || c.status === s.statusFilter) && matchesClient(c, s.query))
      return list.sort((a, b) => b.updatedAt - a.updatedAt)
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

    /** Create or update. Always succeeds locally; sync happens in the background. */
    async save(client) {
      const agency = this.agency()
      const record = { ...emptyClient(), ...client, id: client.id, updatedAt: Date.now(), deleted: false }
      if (!record.createdAt) record.createdAt = record.updatedAt
      const saved = await clientsDb.putLocal(agency, record)
      this.upsertLocal(saved)
      this.sync()
      return saved
    },

    async remove(id) {
      const agency = this.agency()
      const existing = this.items.find((c) => c.id === id)
      if (!existing) return
      const tombstone = { ...existing, deleted: true, updatedAt: Date.now() }
      const saved = await clientsDb.putLocal(agency, tombstone)
      this.upsertLocal(saved)
      this.sync()
    },

    upsertLocal(client) {
      const i = this.items.findIndex((c) => c.id === client.id)
      if (i >= 0) this.items.splice(i, 1, client)
      else this.items.push(client)
    },

    /** Push dirty records, pull remote changes, merge. Safe to call at any time. */
    async sync() {
      const auth = useAuthStore()
      const agency = auth.numagencia
      if (!agency || !auth.token || this.syncing) return false
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
      this.syncing = true
      this.syncError = ''
      try {
        await this.ensureLoaded()
        const changes = pendingChanges(this.items).map(({ dirty, ...c }) => c)
        let result
        try {
          result = await syncClients(auth.token, { since: this.lastSyncAt, changes })
        } catch (err) {
          if (err.status === 401 && (await auth.refreshToken())) {
            result = await syncClients(auth.token, { since: this.lastSyncAt, changes })
          } else throw err
        }
        const acceptedSet = new Set(result.accepted || [])
        await clientsDb.markClean(
          agency,
          changes.filter((c) => acceptedSet.has(c.id)).map((c) => ({ id: c.id, updatedAt: c.updatedAt })),
        )
        const fresh = await clientsDb.all(agency)
        const { merged, replaced } = applyRemoteChanges(fresh, result.changes || [])
        if (replaced.length) {
          const replacedSet = new Set(replaced)
          await clientsDb.putClean(agency, merged.filter((c) => replacedSet.has(c.id)))
        }
        this.items = merged
        this.lastSyncAt = Number(result.serverTime) || Date.now()
        await clientsDb.setMeta(`lastSync:${agency}`, this.lastSyncAt)
        this.needsLogin = false
        return true
      } catch (err) {
        if (err.status === 401) this.needsLogin = true
        else if (err.status !== 0) this.syncError = err.message || 'Error al sincronizar'
        return false
      } finally {
        this.syncing = false
      }
    },

    reset() {
      this.$reset()
    },
  },
})
