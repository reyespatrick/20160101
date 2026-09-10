/**
 * What two versions of the same contact disagree about.
 *
 * Only the fields that actually differ are worth a decision: showing twelve identical lines to
 * make someone find the one that changed is how a good idea becomes a chore. Comparison is on
 * trimmed text, because " Ana " and "Ana" are the same person and no one wants to arbitrate that.
 */
export function differingFields(mine, theirs, fields) {
  const text = (v) => (v === null || v === undefined ? '' : String(v).trim())
  return fields
    .map(({ key, label, read }) => ({
      key,
      label,
      mine: text(mine?.[key]),
      theirs: text(read ? read(theirs) : theirs?.[key]),
    }))
    .filter((row) => row.mine !== row.theirs)
}

/** Apply a merge decision: every field the agent took from Inmovilla, and nothing else. */
export function applyChoice(base, rows, choice) {
  const taken = rows.filter((row) => choice?.[row.key] === 'theirs')
  const next = { ...base }
  for (const row of taken) next[row.key] = row.theirs
  return { next, taken: taken.length }
}
