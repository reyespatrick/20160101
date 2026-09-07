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
 * Merge records fetched from Inmovilla (e.g. a phone search) into the local cache:
 * a local record with unsent edits is kept, anything else is replaced or added.
 */
export function upsertRemote(local, remote) {
  const byRemoteId = new Map(local.filter((r) => r.remoteId).map((r) => [String(r.remoteId), r]))
  const result = [...local]
  for (const rem of remote) {
    const loc = byRemoteId.get(String(rem.remoteId))
    if (loc?.dirty) continue
    const i = loc ? result.indexOf(loc) : -1
    const merged = { ...rem, id: loc?.id || rem.id, dirty: false }
    if (i >= 0) result.splice(i, 1, merged)
    else result.push(merged)
  }
  return result
}
