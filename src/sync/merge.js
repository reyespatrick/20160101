/**
 * Pure merge rules shared with the server (see server/clientsStore.js mergeClient).
 * Kept dependency free so it can be unit tested in Node.
 */

export function pickWinner(local, remote) {
  if (!local) return remote
  if (!remote) return local
  if (remote.updatedAt > local.updatedAt) return remote
  if (remote.updatedAt < local.updatedAt) return local
  return remote.deleted && !local.deleted ? remote : local
}

/**
 * Apply server changes on top of the local list.
 * Local dirty records win when they are newer; otherwise the server copy replaces them.
 * Returns { merged: Client[], replaced: ids taken from the server }
 */
export function applyRemoteChanges(localClients, remoteChanges) {
  const byId = new Map(localClients.map((c) => [c.id, c]))
  const replaced = []
  for (const remote of remoteChanges || []) {
    const local = byId.get(remote.id)
    const winner = pickWinner(local, remote)
    if (winner === remote) {
      byId.set(remote.id, { ...remote, dirty: false })
      replaced.push(remote.id)
    }
  }
  return { merged: [...byId.values()], replaced }
}

export function pendingChanges(localClients) {
  return localClients.filter((c) => c.dirty)
}
