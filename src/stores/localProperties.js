import { defineStore } from 'pinia'
import { createProperty, deleteProperty, updateProperty, uploadPhoto } from '../api/inmovillaRest'
import { propertiesDb } from '../db/propertiesDb'
import { emptyProperty, matchesProperty, newId } from '../models/property'
import { pendingRecords, planFor } from '../sync/outbox'
import { resizeImage } from '../utils/image'
import { useAuthStore } from './auth'

/**
 * Listings created in the app ("altas"). They are drafted on the device (IndexedDB,
 * photos as blobs) and pushed to Inmovilla's REST API: create the listing, then
 * upload each photo. Once in Inmovilla the listing also appears in the normal
 * Inmovilla tab; the local copy keeps its remote id (cod_ofer) for editing.
 */
export const useLocalPropertiesStore = defineStore('localProperties', {
  state: () => ({
    items: [],
    photoMeta: {}, // photoId -> { id, propertyId, uploaded, width, height, size }
    photoUrls: {}, // photoId -> object URL (in-memory only)
    loaded: false,
    loading: false,
    syncing: false,
    uploading: 0,
    lastSyncAt: 0,
    syncError: '',
    needsLogin: false,
    query: '',
    statusFilter: '',
  }),
  getters: {
    active: (s) => s.items.filter((p) => !p.deleted).sort((a, b) => b.updatedAt - a.updatedAt),
    filtered() {
      return this.active.filter((p) => (!this.statusFilter || p.status === this.statusFilter) && matchesProperty(p, this.query))
    },
    pendingPhotosOf: (s) => (p) => (p?.photos || []).filter((ph) => s.photoMeta[ph.id] && !s.photoMeta[ph.id].uploaded).length,
    pendingCount() {
      return this.items.filter((p) => p.dirty).length + this.items.reduce((n, p) => n + (p.deleted ? 0 : this.pendingPhotosOf(p)), 0)
    },
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

    /** Object URLs for a property's photos (blobs live in IndexedDB on this device). */
    async ensurePhotoUrls(property) {
      const agency = this.agency()
      for (const ph of property?.photos || []) {
        if (this.photoUrls[ph.id]) continue
        const local = await propertiesDb.getPhoto(agency, ph.id)
        if (local?.blob) {
          this.photoUrls[ph.id] = URL.createObjectURL(local.blob)
          this.photoMeta[ph.id] = { id: ph.id, propertyId: property.id, uploaded: local.uploaded, size: local.size }
        }
      }
    },

    /** Resize and store a picked file locally. Returns the entry to add to property.photos. */
    async addPhotoFile(propertyId, file, order) {
      const agency = this.agency()
      const { blob, width, height } = await resizeImage(file)
      const id = newId()
      await propertiesDb.putPhoto(agency, { id, propertyId, blob, mime: blob.type, width, height, size: blob.size, uploaded: false })
      this.photoUrls[id] = URL.createObjectURL(blob)
      this.photoMeta[id] = { id, propertyId, uploaded: false, width, height, size: blob.size }
      return { id, order, caption: '' }
    },
    async discardPhoto(photoId) {
      await propertiesDb.deletePhoto(this.agency(), photoId)
      if (this.photoUrls[photoId]) URL.revokeObjectURL(this.photoUrls[photoId])
      delete this.photoUrls[photoId]
      delete this.photoMeta[photoId]
    },

    async save(property) {
      const record = { ...emptyProperty(), ...property, id: property.id, updatedAt: Date.now(), deleted: false, syncError: '' }
      record.photos = (record.photos || []).map((ph, i) => ({ ...ph, order: i }))
      if (!record.createdAt) record.createdAt = record.updatedAt
      const saved = await propertiesDb.putLocal(this.agency(), record)
      this.upsertLocal(saved)
      this.sync()
      return saved
    },
    async remove(id) {
      const agency = this.agency()
      const existing = this.items.find((p) => p.id === id)
      if (!existing) return
      for (const ph of existing.photos || []) await this.discardPhoto(ph.id)
      if (!existing.remoteId) {
        await propertiesDb.remove(agency, id)
        this.items = this.items.filter((p) => p.id !== id)
        return
      }
      const saved = await propertiesDb.putLocal(agency, { ...existing, photos: [], deleted: true, updatedAt: Date.now() })
      this.upsertLocal(saved)
      this.sync()
    },
    upsertLocal(p) {
      const i = this.items.findIndex((x) => x.id === p.id)
      if (i >= 0) this.items.splice(i, 1, p)
      else this.items.push(p)
    },

    /** Push drafts and edits to Inmovilla, then upload photos that are not there yet. */
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
            if (err.status === 0) return false
            if (err.status === 401 || err.status === 403) {
              this.needsLogin = true
              return false
            }
            const failed = { ...record, syncError: err.message || 'Inmovilla rechazó la ficha' }
            await propertiesDb.putLocal(agency, failed)
            this.upsertLocal({ ...failed, dirty: true })
          }
        }
        await this.uploadPendingPhotos(auth.restToken, agency)
        this.lastSyncAt = Date.now()
        await propertiesDb.setMeta(`lastSync:${agency}`, this.lastSyncAt)
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
          const remoteId = await createProperty(token, payload)
          await propertiesDb.markSynced(agency, record.id, { remoteId: remoteId || null })
          break
        }
        case 'update':
          await updateProperty(token, record.remoteId, payload)
          await propertiesDb.markSynced(agency, record.id, {})
          break
        case 'delete':
          await deleteProperty(token, record.remoteId)
          await propertiesDb.remove(agency, record.id)
          break
        default:
          await propertiesDb.remove(agency, record.id)
      }
      this.items = await propertiesDb.all(agency)
    },

    /** Upload photos of listings already in Inmovilla that have not been sent yet. */
    async uploadPendingPhotos(token, agency) {
      for (const p of this.items) {
        if (p.deleted || p.dirty || !p.remoteId) continue
        for (const ph of [...(p.photos || [])].sort((a, b) => a.order - b.order)) {
          const meta = this.photoMeta[ph.id]
          if (!meta || meta.uploaded) continue
          const local = await propertiesDb.getPhoto(agency, ph.id)
          if (!local?.blob) continue
          this.uploading++
          try {
            await uploadPhoto(token, p.remoteId, local.blob, { order: ph.order, caption: ph.caption })
            await propertiesDb.markUploaded(agency, ph.id)
            this.photoMeta[ph.id] = { ...meta, uploaded: true }
          } catch (err) {
            if (err.status === 0) return
            this.syncError = `No se pudo subir una foto a Inmovilla: ${err.message}`
          } finally {
            this.uploading--
          }
        }
      }
    },

    reset() {
      for (const url of Object.values(this.photoUrls)) URL.revokeObjectURL(url)
      this.$reset()
    },
  },
})
