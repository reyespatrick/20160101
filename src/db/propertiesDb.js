/**
 * IndexedDB storage for locally created properties and their photo blobs.
 *
 * Stores:
 *   properties  keyPath "key" = `${agency}:${id}`, index "agency"   (record + dirty flag)
 *   photos      keyPath "key" = `${agency}:${photoId}`, index "property" = `${agency}:${propertyId}`
 *               { id, propertyId, blob, mime, width, height, size, uploaded }
 *   meta        keyPath "key"
 */

const DB_NAME = 'alma-properties'
const DB_VERSION = 1

let dbPromise

function open() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB no disponible'))
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('properties')) {
        db.createObjectStore('properties', { keyPath: 'key' }).createIndex('agency', 'agency', { unique: false })
      }
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'key' }).createIndex('property', 'property', { unique: false })
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB bloqueada'))
  })
  dbPromise.catch(() => (dbPromise = undefined))
  return dbPromise
}

const promisify = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

async function tx(storeName, mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode)
    let result
    Promise.resolve(fn(t.objectStore(storeName)))
      .then((r) => (result = r))
      .catch(reject)
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error || new Error('Transacción cancelada'))
  })
}

const key = (agency, id) => `${agency}:${id}`

function toRecord(agency, property, dirty) {
  const plain = JSON.parse(JSON.stringify(property)) // strip Vue proxies
  return { ...plain, key: key(agency, plain.id), agency: String(agency), dirty: Boolean(dirty) }
}
const fromRecord = (rec) => {
  if (!rec) return null
  const { key: _k, agency: _a, ...p } = rec
  return p
}

export const propertiesDb = {
  async all(agency) {
    const rows = await tx('properties', 'readonly', (s) => promisify(s.index('agency').getAll(String(agency))))
    return rows.map(fromRecord)
  },
  async putLocal(agency, property) {
    await tx('properties', 'readwrite', (s) => promisify(s.put(toRecord(agency, property, true))))
    return { ...JSON.parse(JSON.stringify(property)), dirty: true }
  },
  /** Mark a listing as accepted by Inmovilla (optionally recording its remote id). */
  async markSynced(agency, id, patch = {}) {
    await tx('properties', 'readwrite', async (s) => {
      const rec = await promisify(s.get(key(agency, id)))
      if (rec) await promisify(s.put({ ...rec, ...patch, dirty: false, syncError: '' }))
    })
  },
  async remove(agency, id) {
    await tx('properties', 'readwrite', (s) => promisify(s.delete(key(agency, id))))
  },

  // ---- photos ----
  async putPhoto(agency, photo) {
    const rec = { ...photo, key: key(agency, photo.id), property: key(agency, photo.propertyId) }
    await tx('photos', 'readwrite', (s) => promisify(s.put(rec)))
    return photo
  },
  async getPhoto(agency, photoId) {
    const rec = await tx('photos', 'readonly', (s) => promisify(s.get(key(agency, photoId))))
    if (!rec) return null
    const { key: _k, property: _p, ...photo } = rec
    return photo
  },
  async photosOf(agency, propertyId) {
    const rows = await tx('photos', 'readonly', (s) => promisify(s.index('property').getAll(key(agency, propertyId))))
    return rows.map(({ key: _k, property: _p, ...photo }) => photo)
  },
  /** Photo metadata (no blobs) for every property of the agency. */
  async allPhotoMeta(agency) {
    const rows = await tx('photos', 'readonly', (s) => promisify(s.getAll()))
    return rows
      .filter((r) => r.key.startsWith(`${agency}:`))
      .map(({ blob: _b, key: _k, property: _p, ...meta }) => meta)
  },
  async deletePhoto(agency, photoId) {
    await tx('photos', 'readwrite', (s) => promisify(s.delete(key(agency, photoId))))
  },
  async markUploaded(agency, photoId) {
    await tx('photos', 'readwrite', async (s) => {
      const rec = await promisify(s.get(key(agency, photoId)))
      if (rec) await promisify(s.put({ ...rec, uploaded: true }))
    })
  },

  async getMeta(k) {
    return (await tx('meta', 'readonly', (s) => promisify(s.get(k))))?.value
  },
  async setMeta(k, value) {
    await tx('meta', 'readwrite', (s) => promisify(s.put({ key: k, value })))
  },
}
