import { defineStore } from 'pinia'
import { findByRef } from '../api/inmovilla'
import { createOwner, hostPhoto, isAuthError, isRateLimited, saveProperty, updateOwner } from '../api/inmovillaRest'
import { propertiesDb } from '../db/propertiesDb'
import { emptyProperty, matchesProperty, newId } from '../models/property'
import { pendingRecords } from '../sync/outbox'
import { resizeImage } from '../utils/image'
import { useAuthStore } from './auth'
import { useEnumsStore } from './enums'

/**
 * Listings created in the app. Drafted on the device (IndexedDB, photos as blobs),
 * then sent to Inmovilla's REST API:
 *   1. photos are hosted on the relay to get public URLs (Inmovilla downloads them),
 *   2. POST /propiedades/ creates or updates the listing (identified by `ref`),
 *   3. the cod_ofer is resolved through apiweb (unlimited) for the ficha link,
 *   4. the owner, if any, is created/updated as a propietario linked by cod_ofer.
 * Inmovilla has no delete: a sent listing is "dada de baja" with nodisponible=true.
 * The REST limit for properties is 10 calls/min; a 408 pauses the outbox for a minute.
 */
const RETRY_AFTER_408_MS = 65_000

/**
 * Inmovilla refuses POST /propietarios/ without nombre AND apellidos, so an owner known only by
 * phone cannot be created there yet. The listing still goes out; the owner waits on the device
 * until someone gives it a name, and the screens say so rather than inventing a placeholder.
 */
export const ownerIsComplete = (p) => Boolean(String(p?.ownerName || '').trim() && String(p?.ownerSurname || '').trim())

export const useLocalPropertiesStore = defineStore('localProperties', {
  state: () => ({
    items: [],
    photoMeta: {}, // photoId -> { id, propertyId, uploaded, publicUrl, width, height, size }
    photoUrls: {}, // photoId -> object URL (in-memory only)
    loaded: false,
    loading: false,
    syncing: false,
    uploading: 0,
    lastSyncAt: 0,
    syncError: '',
    needsLogin: false,
    rateLimitedUntil: 0,
    query: '',
    statusFilter: '',
  }),
  getters: {
    active: (s) => s.items.filter((p) => !p.deleted).sort((a, b) => b.updatedAt - a.updatedAt),
    filtered() {
      return this.active.filter((p) => (!this.statusFilter || p.status === this.statusFilter) && matchesProperty(p, this.query))
    },
    pendingPhotosOf: (s) => (p) => (p?.photos || []).filter((ph) => s.photoMeta[ph.id] && !s.photoMeta[ph.id].publicUrl).length,
    pendingCount: (s) => s.items.filter((p) => p.dirty).length,
    byId: (s) => (id) => s.items.find((p) => p.id === String(id) && !p.deleted) || null,
    coverUrl: (s) => (p) => {
      const first = [...(p?.photos || [])].sort((a, b) => a.order - b.order)[0]
      return first ? s.photoUrls[first.id] || '' : ''
    },
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
        this.items = await propertiesDb.all(agency)
        this.lastSyncAt = (await propertiesDb.getMeta(`lastSync:${agency}`)) || 0
        const metas = await propertiesDb.allPhotoMeta(agency)
        this.photoMeta = Object.fromEntries(metas.map((m) => [m.id, m]))
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

    async ensurePhotoUrls(property) {
      const agency = this.agency()
      for (const ph of property?.photos || []) {
        if (this.photoUrls[ph.id]) continue
        const local = await propertiesDb.getPhoto(agency, ph.id)
        if (local?.blob) {
          this.photoUrls[ph.id] = URL.createObjectURL(local.blob)
          this.photoMeta[ph.id] = { id: ph.id, propertyId: property.id, uploaded: local.uploaded, publicUrl: local.publicUrl, size: local.size }
        }
      }
    },
    async addPhotoFile(propertyId, file, order) {
      const agency = this.agency()
      const { blob, width, height } = await resizeImage(file)
      const id = newId()
      await propertiesDb.putPhoto(agency, { id, propertyId, blob, mime: blob.type, width, height, size: blob.size, uploaded: false, publicUrl: '' })
      this.photoUrls[id] = URL.createObjectURL(blob)
      this.photoMeta[id] = { id, propertyId, uploaded: false, publicUrl: '', width, height, size: blob.size }
      return { id, order, caption: '' }
    },
    async discardPhoto(photoId) {
      await propertiesDb.deletePhoto(this.agency(), photoId)
      if (this.photoUrls[photoId]) URL.revokeObjectURL(this.photoUrls[photoId])
      delete this.photoUrls[photoId]
      delete this.photoMeta[photoId]
    },

    /** Is this reference free in Inmovilla? (apiweb lookup; null when it cannot be checked) */
    async refIsAvailable(ref, ownId) {
      const auth = useAuthStore()
      if (navigator.onLine === false) return null
      const local = this.items.find((p) => p.id !== ownId && !p.deleted && p.ref === ref)
      if (local) return false
      try {
        const found = await findByRef(ref)
        if (!found) return true
        const own = this.items.find((p) => p.id === ownId)
        return Boolean(own && own.status !== 'draft' && own.ref === ref)
      } catch {
        return null
      }
    },

    async save(property) {
      const agency = this.agency()
      const existing = this.items.find((p) => p.id === property.id)
      const ownerChanged =
        !existing ||
        ['ownerName', 'ownerSurname', 'ownerPhone', 'ownerEmail'].some((k) => (existing[k] || '') !== (property[k] || '')) ||
        existing.ownerDirty
      const record = { ...emptyProperty(), ...property, id: property.id, updatedAt: Date.now(), deleted: false, syncError: '', ownerDirty: ownerChanged }
      record.photos = (record.photos || []).map((ph, i) => ({ ...ph, order: i }))
      if (!record.createdAt) record.createdAt = record.updatedAt
      const saved = await propertiesDb.putLocal(agency, record)
      this.upsertLocal(saved)
      this.sync()
      return saved
    },

    /**
     * Record something the app learned on its own — the answer to a lookup, a date of check —
     * without turning it into a change worth sending. `save` would mark the listing dirty and
     * push it again, which is the wrong thing to do for bookkeeping.
     */
    async note(id, patch) {
      const updated = await propertiesDb.note(this.agency(), id, patch)
      if (updated) this.upsertLocal(updated)
      return updated
    },

    /** Drafts are deleted locally; listings already in Inmovilla are marked unavailable there. */
    async remove(id) {
      const agency = this.agency()
      const existing = this.items.find((p) => p.id === id)
      if (!existing) return
      if (existing.status === 'draft') {
        for (const ph of existing.photos || []) await this.discardPhoto(ph.id)
        await propertiesDb.remove(agency, id)
        this.items = this.items.filter((p) => p.id !== id)
        return
      }
      await this.save({ ...existing, unavailable: true, status: 'unavailable' })
    },
    async reactivate(id) {
      const existing = this.items.find((p) => p.id === id)
      if (existing) await this.save({ ...existing, unavailable: false, status: 'sent' })
    },

    upsertLocal(p) {
      const i = this.items.findIndex((x) => x.id === p.id)
      if (i >= 0) this.items.splice(i, 1, p)
      else this.items.push(p)
    },

    async sync() {
      const auth = useAuthStore()
      const agency = auth.numagencia
      if (!agency || !auth.hasRest || !auth.canWrite || this.syncing) return false
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
            await this.pushOne(auth, agency, record)
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
            const failed = { ...record, syncError: err.message || 'Inmovilla rechazó la ficha' }
            await propertiesDb.putLocal(agency, failed)
            this.upsertLocal({ ...failed, dirty: true })
          }
        }
        // second pass: cod_ofer / owner for listings sent earlier whose lookup was not ready
        for (const record of this.items.filter((p) => !p.dirty && p.status !== 'draft' && (!p.codOfer || (p.ownerDirty && ownerIsComplete(p))))) {
          try {
            await this.completeRemote(auth, agency, record)
          } catch (err) {
            if (err.status === 0 || isAuthError(err) || isRateLimited(err)) break
          }
        }
        this.lastSyncAt = Date.now()
        await propertiesDb.setMeta(`lastSync:${agency}`, this.lastSyncAt)
        this.needsLogin = false
        return true
      } finally {
        this.syncing = false
      }
    },

    async pushOne(auth, agency, record) {
      if (record.deleted) {
        await propertiesDb.remove(agency, record.id)
        this.items = await propertiesDb.all(agency)
        return
      }
      if (record.status === 'draft') {
        const free = await this.refIsAvailable(record.ref, record.id)
        if (free === false) throw Object.assign(new Error(`La referencia ${record.ref} ya existe en Inmovilla; cámbiala para no sobrescribir otra propiedad`), { status: 409 })
      }
      // 1. host photos so Inmovilla can download them
      const urls = []
      for (const ph of [...(record.photos || [])].sort((a, b) => a.order - b.order)) {
        let meta = this.photoMeta[ph.id]
        if (!meta?.publicUrl) {
          const local = await propertiesDb.getPhoto(agency, ph.id)
          if (!local?.blob) continue
          this.uploading++
          try {
            const url = await hostPhoto(local.blob)
            await propertiesDb.setPhotoUrl(agency, ph.id, url)
            meta = { ...(meta || { id: ph.id, propertyId: record.id }), uploaded: true, publicUrl: url }
            this.photoMeta[ph.id] = meta
          } finally {
            this.uploading--
          }
        }
        urls.push(meta.publicUrl)
      }
      // 2. create / update the listing
      // Inmovilla identifies the town by key_loca and refuses a listing without it. A draft is
      // allowed to carry only the town's name — an agent at the door should never be stopped by
      // a code — so the code is resolved here, at the one moment it becomes mandatory.
      const { dirty, syncError, ...payload } = record
      if (!payload.cityKey && payload.cityName) {
        const enums = useEnumsStore()
        await enums.ensureCiudades().catch(() => {})
        const match = enums.searchCities(payload.cityName, 1)[0]
        if (!match) {
          throw Object.assign(new Error(`Inmovilla no conoce la ciudad «${payload.cityName}»; elige otra en la dirección`), { status: 400 })
        }
        payload.cityKey = match.key_loca
      }
      await saveProperty(payload, urls)
      const status = record.unavailable ? 'unavailable' : 'sent'
      // Keep the town code that was just resolved: the listing now exists in Inmovilla under it.
      await propertiesDb.markSynced(agency, record.id, { status, sentAt: Date.now(), cityKey: payload.cityKey })
      this.items = await propertiesDb.all(agency)
      // 3./4. cod_ofer and owner (best effort; retried on later syncs)
      const fresh = this.items.find((p) => p.id === record.id)
      if (fresh) await this.completeRemote(auth, agency, fresh).catch(() => {})
    },

    async completeRemote(auth, agency, record) {
      let patch = {}
      let codOfer = record.codOfer
      if (!codOfer) {
        const found = await findByRef(record.ref)
        if (found?.cod_ofer) {
          codOfer = String(found.cod_ofer)
          patch.codOfer = codOfer
        }
      }
      if (codOfer && record.ownerDirty && ownerIsComplete(record)) {
        const withCod = { ...record, codOfer }
        if (record.ownerRemoteId) await updateOwner(withCod)
        else patch.ownerRemoteId = await createOwner(withCod)
        patch.ownerDirty = false
      }
      if (Object.keys(patch).length) {
        await propertiesDb.markSynced(agency, record.id, patch)
        this.items = await propertiesDb.all(agency)
      }
    },

    reset() {
      for (const url of Object.values(this.photoUrls)) URL.revokeObjectURL(url)
      this.$reset()
    },
  },
})
