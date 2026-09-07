/**
 * Client (contact) records: sanitizer + store built on the generic SyncStore.
 */
import { SyncStore, clampUpdatedAt, list, mergeRecord, num, str, validId } from './syncStore.js'

export const CLIENT_FIELDS = [
  'id', 'name', 'surname', 'phone', 'email', 'type', 'status', 'operation', 'propertyTypes',
  'zones', 'budgetMin', 'budgetMax', 'bedrooms', 'notes', 'properties', 'createdAt', 'updatedAt', 'deleted',
]

/** Normalise an incoming client record; returns null if unusable. */
export function sanitizeClient(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null
  const id = str(raw.id, 64)
  if (!validId(id)) return null
  const updatedAt = clampUpdatedAt(raw, now)
  return {
    id,
    name: str(raw.name),
    surname: str(raw.surname),
    phone: str(raw.phone, 60),
    email: str(raw.email, 200),
    type: str(raw.type, 30),
    status: str(raw.status, 30),
    operation: str(raw.operation, 20),
    propertyTypes: list(raw.propertyTypes),
    zones: list(raw.zones),
    budgetMin: num(raw.budgetMin),
    budgetMax: num(raw.budgetMax),
    bedrooms: num(raw.bedrooms),
    notes: str(raw.notes, 4000),
    properties: list(raw.properties),
    createdAt: num(raw.createdAt) ?? updatedAt,
    updatedAt,
    deleted: Boolean(raw.deleted),
  }
}

export const mergeClient = mergeRecord

export class ClientsStore extends SyncStore {
  constructor(file) {
    super(file, sanitizeClient)
  }
}
