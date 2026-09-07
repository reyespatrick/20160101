/**
 * Pure helpers for the device-side outbox (records edited locally and not yet
 * accepted by Inmovilla). Kept dependency free so they can be unit tested in Node.
 *
 * Record flags:
 *   dirty     changed locally since the last successful push
 *   remoteId  id in Inmovilla once created there
 *   deleted   tombstone; pushed as a DELETE, then dropped locally
 *   syncError last error text from Inmovilla (cleared on success)
 */

export function pendingRecords(records) {
  return records.filter((r) => r.dirty)
}

/** What to do with one dirty record. */
export function planFor(record) {
  if (record.deleted) return record.remoteId ? 'delete' : 'drop'
  return record.remoteId ? 'update' : 'create'
}

/**
 * Merge the list fetched from Inmovilla into the local cache.
 * - records with local unsent edits are kept as they are
 * - clean records are replaced by the remote copy (Inmovilla is the source of truth)
 * - clean records missing remotely were deleted elsewhere → dropped
 * - remote records never seen locally are added
 */
export function mergeRemoteList(local, remote) {
  const byRemoteId = new Map()
  for (const r of local) if (r.remoteId) byRemoteId.set(String(r.remoteId), r)
  const result = []
  const seen = new Set()
  for (const rem of remote) {
    const key = String(rem.remoteId)
    seen.add(key)
    const loc = byRemoteId.get(key)
    if (loc?.dirty) result.push(loc)
    else result.push({ ...rem, id: loc?.id || rem.id, dirty: false })
  }
  for (const r of local) {
    if (!r.remoteId) result.push(r) // created offline, not pushed yet
    else if (!seen.has(String(r.remoteId)) && r.dirty) result.push(r) // edited offline, deleted remotely: keep the edit
  }
  return result
}
