/**
 * Factory for a small IndexedDB "cache + outbox" store keyed by `${agency}:${id}`.
 * Records keep a `dirty` flag (changed locally, not yet accepted by Inmovilla).
 */
export function createSimpleDb(dbName, storeName) {
  let dbPromise
  function open() {
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error('IndexedDB no disponible'))
      const req = indexedDB.open(dbName, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'key' }).createIndex('agency', 'agency', { unique: false })
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
      }
      req.onsuccess = () => {
        const db = req.result
        // A database can exist at this version and still lack its stores — it only takes another
        // module opening it by name first, which creates it empty. Rather than being crippled for
        // good, bump the version once and build what is missing.
        if (!db.objectStoreNames.contains(storeName) || !db.objectStoreNames.contains('meta')) {
          const version = db.version + 1
          db.close()
          const again = indexedDB.open(dbName, version)
          again.onupgradeneeded = () => {
            const fresh = again.result
            if (!fresh.objectStoreNames.contains(storeName)) fresh.createObjectStore(storeName, { keyPath: 'key' }).createIndex('agency', 'agency', { unique: false })
            if (!fresh.objectStoreNames.contains('meta')) fresh.createObjectStore('meta', { keyPath: 'key' })
          }
          again.onsuccess = () => resolve(again.result)
          again.onerror = () => reject(again.error)
          return
        }
        resolve(db)
      }
      req.onerror = () => reject(req.error)
    })
    dbPromise.catch(() => (dbPromise = undefined))
    return dbPromise
  }
  const promisify = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  async function tx(store, mode, fn) {
    const db = await open()
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode)
      let result
      Promise.resolve(fn(t.objectStore(store))).then((r) => (result = r)).catch(reject)
      t.oncomplete = () => resolve(result)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error || new Error('Transacción cancelada'))
    })
  }
  const keyOf = (agency, id) => `${agency}:${id}`
  const toRecord = (agency, rec, dirty) => {
    const plain = JSON.parse(JSON.stringify(rec))
    return { ...plain, key: keyOf(agency, plain.id), agency: String(agency), dirty: Boolean(dirty) }
  }
  const fromRecord = (rec) => {
    if (!rec) return null
    const { key: _k, agency: _a, ...r } = rec
    return r
  }
  return {
    async all(agency) {
      return (await tx(storeName, 'readonly', (s) => promisify(s.index('agency').getAll(String(agency))))).map(fromRecord)
    },
    async putLocal(agency, rec) {
      await tx(storeName, 'readwrite', (s) => promisify(s.put(toRecord(agency, rec, true))))
      return { ...JSON.parse(JSON.stringify(rec)), dirty: true }
    },
    async putClean(agency, list) {
      await tx(storeName, 'readwrite', (s) => Promise.all(list.map((r) => promisify(s.put(toRecord(agency, r, false))))))
    },
    async markSynced(agency, id, patch = {}) {
      await tx(storeName, 'readwrite', async (s) => {
        const rec = await promisify(s.get(keyOf(agency, id)))
        if (rec) await promisify(s.put({ ...rec, ...patch, dirty: false, syncError: '' }))
      })
    },
    async patch(agency, id, patch) {
      await tx(storeName, 'readwrite', async (s) => {
        const rec = await promisify(s.get(keyOf(agency, id)))
        if (rec) await promisify(s.put({ ...rec, ...patch }))
      })
    },
    async remove(agency, id) {
      await tx(storeName, 'readwrite', (s) => promisify(s.delete(keyOf(agency, id))))
    },
    async getMeta(k) {
      return (await tx('meta', 'readonly', (s) => promisify(s.get(k))))?.value
    },
    async setMeta(k, value) {
      await tx('meta', 'readwrite', (s) => promisify(s.put({ key: k, value })))
    },
  }
}
