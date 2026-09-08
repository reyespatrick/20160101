import { defineStore } from 'pinia'
import { createOwnerRecord, deleteOwner, getOwnerByCodOfer, isAuthError, isRateLimited, updateOwnerRecord } from '../api/inmovillaRest'
import { ownersDb } from '../db/ownersDb'
import { emptyOwner } from '../models/owner'
import { pendingRecords, planFor } from '../sync/outbox'
import { useAuthStore } from './auth'

/**
 * Owners ("propietarios") live in Inmovilla, linked to listings. The device caches the
 * owners it has looked up (by listing) and keeps an outbox: create (POST with cod_ofer),
 * update (PUT cod_cli), delete (DELETE). Limit 20 calls/min.
 */
const RETRY_AFTER_408_MS = 65_000

export const useOwnersStore = defineStore('owners', {
  state: () => ({
    items: [],
    loaded: false,
    syncing: false,
    loadingFor: {}, // codOfer -> true while fetching
    checkedFor: {}, // codOfer -> timestamp of last Inmovilla lookup
    syncError: '',
    needsLogin: false,
    rateLimitedUntil: 0,
  }),
  getters: {
    pendingCount: (s) => s.items.filter((o) => o.dirty).length,
    byId: (s) => (id) => s.items.find((o) => o.id === String(id) && !o.deleted) || null,
    /** Owner of a listing: matched by the cod_ofer it was created for or by Inmovilla's property list. */
    forProperty: (s) => (codOfer) =>
      s.items.find((o) => !o.deleted && (String(o.codOfer) === String(codOfer) || (o.properties || []).some((p) => String(p.codOfer) === String(codOfer)))) || null,
  },
  actions: {
    agency() {
      return useAuthStore().numagencia
    },
    async ensureLoaded() {
      if (this.loaded) return
      const agency = this.agency()
      if (!agency) return
      try {
        this.items = await ownersDb.all(agency)
        this.loaded = true
      } catch (err) {
        this.syncError = err.message
      }
    },

    /** Look the owner of a listing up in Inmovilla (once per hour per listing) and cache it. */
    async loadForProperty(codOfer, { force = false } = {}) {
      await this.ensureLoaded()
      const auth = useAuthStore()
      const key = String(codOfer)
      if (!auth.hasKeys || navigator.onLine === false || this.loadingFor[key]) return this.forProperty(codOfer)
      if (!force && Date.now() - (this.checkedFor[key] || 0) < 60 * 60_000) return this.forProperty(codOfer)
      this.loadingFor[key] = true
      try {
        const remote = await getOwnerByCodOfer(codOfer)
        this.checkedFor[key] = Date.now()
        const local = this.items.find((o) => remote && String(o.remoteId) === String(remote.remoteId))
        if (remote && !local?.dirty) {
          const merged = { ...remote, id: local?.id || remote.id, codOfer: local?.codOfer || String(codOfer), dirty: false }
          await ownersDb.putClean(this.agency(), [merged])
          this.upsertLocal(merged)
        } else if (!remote) {
          // No owner in Inmovilla any more: drop clean cached copies tied to this listing
          for (const o of this.items.filter((x) => !x.dirty && String(x.codOfer) === key)) {
            await ownersDb.remove(this.agency(), o.id)
            this.items = this.items.filter((x) => x.id !== o.id)
          }
        }
      } catch (err) {
        this.noteError(err)
      } finally {
        delete this.loadingFor[key]
      }
      return this.forProperty(codOfer)
    },

    async save(owner) {
      const record = { ...emptyOwner(), ...owner, id: owner.id, updatedAt: Date.now(), deleted: false, syncError: '' }
      const saved = await ownersDb.putLocal(this.agency(), record)
      this.upsertLocal(saved)
      this.sync()
      return saved
    },
    async remove(id) {
      const existing = this.items.find((o) => o.id === id)
      if (!existing) return
      if (!existing.remoteId) {
        await ownersDb.remove(this.agency(), id)
        this.items = this.items.filter((o) => o.id !== id)
        return
      }
      const saved = await ownersDb.putLocal(this.agency(), { ...existing, deleted: true, updatedAt: Date.now() })
      this.upsertLocal(saved)
      this.sync()
    },
    upsertLocal(o) {
      const i = this.items.findIndex((x) => x.id === o.id)
      if (i >= 0) this.items.splice(i, 1, o)
      else this.items.push(o)
    },
    noteError(err) {
      if (isAuthError(err)) this.needsLogin = true
      else if (isRateLimited(err)) this.rateLimitedUntil = Date.now() + RETRY_AFTER_408_MS
      else if (err.status !== 0) this.syncError = err.message || 'Error al hablar con Inmovilla'
    },

    async sync() {
      const auth = useAuthStore()
      const agency = auth.numagencia
      if (!agency || !auth.hasKeys || !auth.canWrite || this.syncing) return false
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
      if (this.rateLimitedUntil > Date.now()) {
        setTimeout(() => this.sync(), this.rateLimitedUntil - Date.now() + 500)
        return false
      }
      this.syncing = true
      this.syncError = ''
      try {
        await this.ensureLoaded()
        for (const record of pendingRecords(this.items)) {
          try {
            const { dirty, syncError, ...payload } = record
            switch (planFor(record)) {
              case 'create': {
                const remoteId = await createOwnerRecord(payload)
                await ownersDb.markSynced(agency, record.id, { remoteId: remoteId || null })
                break
              }
              case 'update':
                await updateOwnerRecord(payload)
                await ownersDb.markSynced(agency, record.id, {})
                break
              case 'delete':
                await deleteOwner(record.remoteId)
                await ownersDb.remove(agency, record.id)
                break
              default:
                await ownersDb.remove(agency, record.id)
            }
          } catch (err) {
            if (err.status === 0) return false
            if (isAuthError(err)) {
              this.needsLogin = true
              return false
            }
            if (isRateLimited(err)) {
              this.rateLimitedUntil = Date.now() + RETRY_AFTER_408_MS
              setTimeout(() => this.sync(), RETRY_AFTER_408_MS + 500)
              return false
            }
            await ownersDb.putLocal(agency, { ...record, syncError: err.message || 'Inmovilla rechazó el propietario' })
          }
        }
        this.items = await ownersDb.all(agency)
        this.needsLogin = false
        return true
      } finally {
        this.syncing = false
      }
    },
    reset() {
      this.$reset()
    },
  },
})
