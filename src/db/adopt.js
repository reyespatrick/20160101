/**
 * Moving what a device holds from one agency to another.
 *
 * Every local record is filed under the agency's Inmovilla number, so the day that number changes
 * — a correction, a migration, an account rebuilt elsewhere — an afternoon of drafts written in
 * front of doors becomes invisible. The records are still there, filed under a name nobody uses
 * any more.
 *
 * Nothing is moved on its own. A device shared by two agencies would otherwise hand one's clients
 * to the other, which is worse than the problem: the app counts what it found, says whose it was,
 * and moves it only when someone says so.
 */
const STORES = [
  ['immoba-properties', 'properties'],
  ['immoba-clients', 'clients'],
  ['immoba-followups', 'followups'],
  ['immoba-owners', 'owners'],
  ['immoba-estimates', 'estimates'],
]

/**
 * Open a database this module did not create — and only if it already exists.
 *
 * `indexedDB.open(name)` on an unknown name does not fail: it creates the database, empty, at
 * version 1. The module that owns it then opens it at version 1 too, its upgrade never fires, and
 * it is left without a single object store — permanently unable to save anything. Looking first
 * is the whole difference between reading someone else's data and destroying it.
 */
async function open(name) {
  const known = globalThis.indexedDB?.databases ? await indexedDB.databases() : null
  if (!known || !known.some((d) => d.name === name)) return null
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name) // no version: never upgrade, only read
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB bloqueada'))
  })
}

const promisify = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

async function withStore(dbName, storeName, mode, fn) {
  let db
  try {
    db = await open(dbName)
  } catch {
    return null
  }
  if (!db) return null
  if (!db.objectStoreNames.contains(storeName)) {
    db.close()
    return null
  }
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode)
      let out
      Promise.resolve(fn(t.objectStore(storeName))).then((r) => (out = r)).catch(reject)
      t.oncomplete = () => resolve(out)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error || new Error('Transacción cancelada'))
    })
  } finally {
    db.close()
  }
}

/** What this device holds for agencies other than the one signed in, counted per agency. */
export async function findOrphans(currentAgency) {
  const counts = {}
  for (const [dbName, storeName] of STORES) {
    const rows = await withStore(dbName, storeName, 'readonly', (s) => promisify(s.getAll())).catch(() => null)
    for (const row of rows || []) {
      const agency = String(row?.agency || '')
      if (!agency || agency === String(currentAgency) || row?.deleted) continue
      counts[agency] = (counts[agency] || 0) + 1
    }
  }
  return Object.entries(counts)
    .map(([agency, count]) => ({ agency, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Re-file every record of one agency under another. The key carries the agency, so each record is
 * rewritten under a new key and the old one removed — in a single transaction per store, so a
 * refresh in the middle cannot leave half a listing behind.
 */
export async function adoptFrom(fromAgency, toAgency) {
  let moved = 0
  for (const [dbName, storeName] of STORES) {
    await withStore(dbName, storeName, 'readwrite', async (s) => {
      const rows = await promisify(s.getAll())
      for (const row of rows) {
        if (String(row?.agency || '') !== String(fromAgency)) continue
        const oldKey = row.key
        const next = { ...row, agency: String(toAgency), key: String(oldKey).replace(`${fromAgency}:`, `${toAgency}:`) }
        await promisify(s.put(next))
        if (next.key !== oldKey) await promisify(s.delete(oldKey))
        moved += 1
      }
    }).catch(() => null)
  }
  return moved
}
