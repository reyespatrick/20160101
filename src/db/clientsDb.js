/**
 * Minimal promise wrapper around IndexedDB for the clients module.
 *
 * Stores:
 *   clients  keyPath "key" = `${agency}:${id}`, index "agency"
 *   meta     keyPath "key"  (per-agency lastSync)
 *
 * Every record keeps a `dirty` flag meaning "changed locally, not yet confirmed by the server".
 */

const DB_NAME = 'immoba-clients'
const DB_VERSION = 1

let dbPromise

function open() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB no disponible'))
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('clients')) {
        const store = db.createObjectStore('clients', { keyPath: 'key' })
        store.createIndex('agency', 'agency', { unique: false })
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
    }
    req.onsuccess = () => {
      const db = req.result
      // A database can exist at this version and still lack its stores — it only takes another
      // module opening it by name first, which creates it empty. Rather than being crippled for
      // good, bump the version once and let the upgrade above build what is missing.
      if (!db.objectStoreNames.contains('clients') || !db.objectStoreNames.contains('meta')) {
        const version = db.version + 1
        db.close()
        const again = indexedDB.open(DB_NAME, version)
        again.onupgradeneeded = () => {
          const fresh = again.result
          if (!fresh.objectStoreNames.contains('clients')) fresh.createObjectStore('clients', { keyPath: 'key' }).createIndex('agency', 'agency', { unique: false })
          if (!fresh.objectStoreNames.contains('meta')) fresh.createObjectStore('meta', { keyPath: 'key' })
        }
        again.onsuccess = () => resolve(again.result)
        again.onerror = () => reject(again.error)
        return
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB bloqueada'))
  })
  dbPromise.catch(() => (dbPromise = undefined))
  return dbPromise
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function tx(storeName, mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode)
    const store = t.objectStore(storeName)
    let result
    Promise.resolve(fn(store))
      .then((r) => (result = r))
      .catch(reject)
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error || new Error('Transacción cancelada'))
  })
}

const keyOf = (agency, id) => `${agency}:${id}`

function toRecord(agency, client, dirty) {
  // Vue reactive proxies cannot be structured-cloned by IndexedDB: store a plain copy.
  const plain = JSON.parse(JSON.stringify(client))
  return { ...plain, key: keyOf(agency, plain.id), agency: String(agency), dirty: Boolean(dirty) }
}

function fromRecord(rec) {
  if (!rec) return null
  const { key, agency, ...client } = rec
  return client
}

export const clientsDb = {
  async all(agency) {
    const rows = await tx('clients', 'readonly', (s) => promisify(s.index('agency').getAll(String(agency))))
    return rows.map(fromRecord)
  },

  async get(agency, id) {
    return fromRecord(await tx('clients', 'readonly', (s) => promisify(s.get(keyOf(agency, id)))))
  },

  /** Save a local edit: marks the record dirty so it is pushed on the next sync. */
  async putLocal(agency, client) {
    await tx('clients', 'readwrite', (s) => promisify(s.put(toRecord(agency, client, true))))
    return { ...client, dirty: true }
  },

  /** Write records fetched from Inmovilla (clean). */
  async putClean(agency, clients) {
    await tx('clients', 'readwrite', (s) => Promise.all(clients.map((c) => promisify(s.put(toRecord(agency, c, false))))))
  },

  /**
   * Write a few fields without touching the sync flag — bookkeeping the agent did not do, such
   * as "Inmovilla has been asked about this number". A contact already sent must not be pushed
   * again for it, and one still waiting must not stop waiting.
   */
  async note(agency, id, patch) {
    let updated = null
    await tx('clients', 'readwrite', async (s) => {
      const rec = await promisify(s.get(keyOf(agency, id)))
      if (!rec) return
      updated = { ...rec, ...patch }
      await promisify(s.put(updated))
    })
    return updated
  },

  /** Mark a record as accepted by Inmovilla (optionally recording its remote id). */
  async markSynced(agency, id, patch = {}) {
    await tx('clients', 'readwrite', async (s) => {
      const rec = await promisify(s.get(keyOf(agency, id)))
      if (rec) await promisify(s.put({ ...rec, ...patch, dirty: false, syncError: '' }))
    })
  },

  async remove(agency, id) {
    await tx('clients', 'readwrite', (s) => promisify(s.delete(keyOf(agency, id))))
  },

  /** Replace the whole cache of an agency with the merged list. */
  async replaceAll(agency, clients) {
    const keys = await tx('clients', 'readonly', (s) => promisify(s.index('agency').getAllKeys(String(agency))))
    await tx('clients', 'readwrite', async (s) => {
      for (const k of keys) await promisify(s.delete(k))
      for (const c of clients) await promisify(s.put(toRecord(agency, c, c.dirty)))
    })
  },

  async getMeta(key) {
    const row = await tx('meta', 'readonly', (s) => promisify(s.get(key)))
    return row?.value
  },

  async setMeta(key, value) {
    await tx('meta', 'readwrite', (s) => promisify(s.put({ key, value })))
  },

  async clearAgency(agency) {
    const rows = await tx('clients', 'readonly', (s) => promisify(s.index('agency').getAllKeys(String(agency))))
    await tx('clients', 'readwrite', (s) => Promise.all(rows.map((k) => promisify(s.delete(k)))))
    await tx('meta', 'readwrite', (s) => promisify(s.delete(`lastSync:${agency}`)))
  },
}
