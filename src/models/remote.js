/**
 * Telling "someone changed this in the office" from "I changed this on the phone".
 *
 * Every write to Inmovilla is an upsert — a listing is matched on its `ref`, a contact on its
 * `cod_cli` — so a draft sent from the phone silently overwrites whatever the office edited in
 * the meantime, and nobody ever sees it happen.
 *
 * Comparing timestamps would not fix it. Inmovilla dates a listing (`fechaact`) but not a
 * contact, a phone's clock is whatever its owner set, and the most recent edit is not the
 * best-informed one: the agent saw the flat yesterday, the secretary corrected the price this
 * morning after the owner rang. What matters is not *when* but **who changed what since the two
 * sides last agreed** — which is knowable exactly, provided we keep what Inmovilla last told us.
 */

/** The fields worth arbitrating: those both sides carry, and that a person would notice. */
export const REMOTE_FIELDS = [
  { key: 'price', from: 'precioinmo', labelKey: 'props.form.price', number: true },
  { key: 'priceRent', from: 'precioalq', labelKey: 'props.form.priceRent', number: true },
  { key: 'operation', from: 'keyacci', labelKey: 'props.rows.operation', number: true },
  { key: 'typeKey', from: 'key_tipo', labelKey: 'props.form.type', number: true },
  { key: 'bedrooms', from: 'habitaciones', labelKey: 'props.form.bedrooms', number: true },
  { key: 'bathrooms', from: 'banyos', labelKey: 'props.form.baths', number: true },
  { key: 'builtArea', from: 'm_cons', labelKey: 'props.form.built', number: true },
  { key: 'plotArea', from: 'm_parcela', labelKey: 'props.form.plot', number: true },
]

/**
 * Are these two the same value, allowing for the several ways the two sides write "nothing"?
 *
 * apiweb answers `0` for a rent that does not apply and `''` for a plot a flat does not have,
 * where the app holds `null`. Every field compared here is a quantity, so zero and absent say
 * the same thing — and treating them as different would have flagged a conflict on every listing
 * for sale, on the rent it does not have.
 */
export function same(a, b) {
  const norm = (v) => {
    if (v === null || v === undefined || v === '') return ''
    const n = Number(v)
    if (Number.isFinite(n)) return n === 0 ? '' : String(n)
    return String(v).trim()
  }
  return norm(a) === norm(b)
}

/** What Inmovilla holds right now, read from an apiweb row. */
export function snapshotOfRemote(row) {
  if (!row) return null
  const out = {}
  for (const f of REMOTE_FIELDS) out[f.key] = row[f.from] ?? null
  return out
}

/** What we are about to make Inmovilla hold, read from our own listing. */
export function snapshotOfLocal(property) {
  if (!property) return null
  const out = {}
  for (const f of REMOTE_FIELDS) out[f.key] = property[f.key] ?? null
  return out
}

/**
 * The fields where the two versions disagree, each carrying which side moved.
 *
 * `base` is what both sides last agreed on. A field only becomes a question when the office
 * changed it *and* the phone changed it to something else; where a single side moved, there is
 * nothing to arbitrate and `prefer` says which one to take.
 */
export function compareToBase({ base, remote, local }) {
  if (!base || !remote || !local) return []
  return REMOTE_FIELDS.map((f) => {
    const theirs = remote[f.key] ?? null
    const mine = local[f.key] ?? null
    const remoteMoved = !same(theirs, base[f.key] ?? null)
    const localMoved = !same(mine, base[f.key] ?? null)
    return { key: f.key, labelKey: f.labelKey, mine, theirs, remoteMoved, localMoved, prefer: remoteMoved && !localMoved ? 'theirs' : 'mine' }
  }).filter((row) => !same(row.mine, row.theirs))
}

/** Has the office touched this listing since we last looked? Then we must not overwrite blindly. */
export function officeMoved(rows) {
  return rows.some((row) => row.remoteMoved)
}
