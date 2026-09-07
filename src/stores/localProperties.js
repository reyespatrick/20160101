import { defineStore } from 'pinia'
import { downloadPhoto, syncProperties, uploadPhoto } from '../api/properties'
import { propertiesDb } from '../db/propertiesDb'
import { emptyProperty, matchesProperty, newId } from '../models/property'
import { applyRemoteChanges, pendingChanges } from '../sync/merge'
import { resizeImage } from '../utils/image'
import { useAuthStore } from './auth'

/**
 * Offline-first store for properties created in the app ("altas").
 *
 * Metadata syncs like clients (push dirty, pull since). Photos are blobs in
 * IndexedDB, displayed through object URLs, uploaded one by one after the
 * metadata sync and downloaded on demand when another device created them.
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
    pendingCount: (s) => s.items.filter((p) => p.dirty).length + Object.values(s.photoMeta).filter((m) => !m.uploaded).length,
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

    /** Object URLs for a property's photos, loading blobs from IndexedDB (and the server) as needed. */
    async ensurePhotoUrls(property) {
      const agency = this.agency()
      const auth = useAuthStore()
      const missing = []
      for (const ph of property?.photos || []) {
        if (this.photoUrls[ph.id]) continue
        const local = await propertiesDb.getPhoto(agency, ph.id)
        if (local?.blob) {
          this.photoUrls[ph.id] = URL.createObjectURL(local.blob)
          this.photoMeta[ph.id] = { id: ph.id, propertyId: property.id, uploaded: local.uploaded, size: local.size }
        } else missing.push(ph.id)
      }
      if (!missing.length || !auth.token || navigator.onLine === false) return
      for (const id of missing) {
        try {
          const blob = await downloadPhoto(auth.token, property.id, id)
          if (!blob) continue
          const photo = { id, propertyId: property.id, blob, mime: blob.type, size: blob.size, uploaded: true }
          await propertiesDb.putPhoto(agency, photo)
          this.photoUrls[id] = URL.createObjectURL(blob)
          this.photoMeta[id] = { id, propertyId: property.id, uploaded: true, size: blob.size }
        } catch {
          /* stay without the photo for now */
        }
      }
    },

    /** Resize and store a picked file locally. Returns the photo entry to add to property.photos. */
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
      const agency = this.agency()
      await propertiesDb.deletePhoto(agency, photoId)
      if (this.photoUrls[photoId]) URL.revokeObjectURL(this.photoUrls[photoId])
      delete this.photoUrls[photoId]
      delete this.photoMeta[photoId]
    },

    async save(property) {
      const agency = this.agency()
      const record = { ...emptyProperty(), ...property, id: property.id, updatedAt: Date.now(), deleted: false }
      record.photos = (record.photos || []).map((ph, i) => ({ ...ph, order: i }))
      if (!record.createdAt) record.createdAt = record.updatedAt
      const saved = await propertiesDb.putLocal(agency, record)
      this.upsertLocal(saved)
      this.sync()
      return saved
    },

    async remove(id) {
      const agency = this.agency()
      const existing = this.items.find((p) => p.id === id)
      if (!existing) return
      for (const ph of existing.photos || []) await this.discardPhoto(ph.id)
      const saved = await propertiesDb.putLocal(agency, { ...existing, photos: [], deleted: true, updatedAt: Date.now() })
      this.upsertLocal(saved)
      this.sync()
    },

    upsertLocal(p) {
      const i = this.items.findIndex((x) => x.id === p.id)
      if (i >= 0) this.items.splice(i, 1, p)
      else this.items.push(p)
    },

    async sync() {
      const auth = useAuthStore()
      const agency = auth.numagencia
      if (!agency || !auth.token || this.syncing) return false
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
      this.syncing = true
      this.syncError = ''
      try {
        await this.ensureLoaded()
        const changes = pendingChanges(this.items).map(({ dirty, ...p }) => p)
        let result
        try {
          result = await syncProperties(auth.token, { since: this.lastSyncAt, changes })
        } catch (err) {
          if (err.status === 401 && (await auth.refreshToken())) {
            result = await syncProperties(auth.token, { since: this.lastSyncAt, changes })
          } else throw err
        }
        const acceptedSet = new Set(result.accepted || [])
        await propertiesDb.markClean(
          agency,
          changes.filter((p) => acceptedSet.has(p.id)).map((p) => ({ id: p.id, updatedAt: p.updatedAt })),
        )
        const fresh = await propertiesDb.all(agency)
        const { merged, replaced } = applyRemoteChanges(fresh, result.changes || [])
        if (replaced.length) {
          const set = new Set(replaced)
          await propertiesDb.putClean(agency, merged.filter((p) => set.has(p.id)))
        }
        this.items = merged
        this.lastSyncAt = Number(result.serverTime) || Date.now()
        await propertiesDb.setMeta(`lastSync:${agency}`, this.lastSyncAt)
        this.needsLogin = false
        await this.uploadPendingPhotos(result.storedPhotos || {})
        return true
      } catch (err) {
        if (err.status === 401) this.needsLogin = true
        else if (err.status !== 0) this.syncError = err.message || 'Error al sincronizar'
        return false
      } finally {
        this.syncing = false
      }
    },

    /** Upload photos the server does not have yet, for properties it already knows. */
    async uploadPendingPhotos(storedPhotos) {
      const auth = useAuthStore()
      const agency = auth.numagencia
      for (const p of this.items) {
        if (p.deleted || p.dirty) continue // server must know the property (and its photo list) first
        const stored = new Set(storedPhotos[p.id] || [])
        for (const ph of p.photos || []) {
          if (stored.has(ph.id)) {
            if (this.photoMeta[ph.id] && !this.photoMeta[ph.id].uploaded) {
              await propertiesDb.markUploaded(agency, ph.id)
              this.photoMeta[ph.id] = { ...this.photoMeta[ph.id], uploaded: true }
            }
            continue
          }
          const local = await propertiesDb.getPhoto(agency, ph.id)
          if (!local?.blob) continue // created elsewhere and not uploaded yet
          this.uploading++
          try {
            await uploadPhoto(auth.token, p.id, ph.id, local.blob)
            await propertiesDb.markUploaded(agency, ph.id)
            this.photoMeta[ph.id] = { ...(this.photoMeta[ph.id] || { id: ph.id, propertyId: p.id }), uploaded: true }
          } catch (err) {
            if (err.status === 0) return // offline: retry on next sync
            this.syncError = `No se pudo subir una foto: ${err.message}`
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
