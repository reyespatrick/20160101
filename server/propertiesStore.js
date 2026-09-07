/**
 * Locally created property listings ("altas") with photos.
 *
 * Metadata follows the SyncStore rules. Photo binaries live on disk under
 * DATA_DIR/photos/<agency>/<propertyId>/<photoId>.jpg and are uploaded /
 * downloaded one by one after the metadata sync.
 */
import { mkdir, readdir, rm, stat, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { SyncStore, clampUpdatedAt, list, num, str, validId } from './syncStore.js'

export const FEATURE_KEYS = [
  'ascensor', 'terraza', 'balcon', 'plaza_gara', 'trastero', 'piscina_com', 'piscina_prop', 'aire_con',
  'calefaccion', 'muebles', 'jardin', 'vistasalmar', 'primera_line', 'chimenea', 'urbanizacion', 'exclu',
]

export const MAX_PHOTOS = 30
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024

export function sanitizeProperty(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null
  const id = str(raw.id, 64)
  if (!validId(id)) return null
  const updatedAt = clampUpdatedAt(raw, now)
  const photos = Array.isArray(raw.photos)
    ? raw.photos
        .slice(0, MAX_PHOTOS)
        .map((p, i) => ({ id: str(p?.id, 64), order: num(p?.order) ?? i, caption: str(p?.caption, 200) }))
        .filter((p) => validId(p.id))
    : []
  const features = {}
  for (const key of FEATURE_KEYS) features[key] = raw.features?.[key] ? 1 : 0
  return {
    id,
    ref: str(raw.ref, 40),
    status: str(raw.status, 30) || 'draft',
    operation: str(raw.operation, 20) || 'sale', // sale | rent
    type: str(raw.type, 60),
    price: num(raw.price),
    priceRent: num(raw.priceRent),
    title: str(raw.title, 160),
    description: str(raw.description, 8000),
    address: str(raw.address, 200),
    city: str(raw.city, 100),
    zone: str(raw.zone, 100),
    province: str(raw.province, 100),
    postalCode: str(raw.postalCode, 12),
    bedrooms: num(raw.bedrooms),
    bathrooms: num(raw.bathrooms),
    builtArea: num(raw.builtArea),
    usableArea: num(raw.usableArea),
    plotArea: num(raw.plotArea),
    floor: str(raw.floor, 20),
    yearBuilt: num(raw.yearBuilt),
    condition: str(raw.condition, 40),
    energyRating: str(raw.energyRating, 3),
    orientation: str(raw.orientation, 20),
    features,
    ownerName: str(raw.ownerName, 160),
    ownerPhone: str(raw.ownerPhone, 60),
    notes: str(raw.notes, 4000),
    photos,
    tags: list(raw.tags),
    createdAt: num(raw.createdAt) ?? updatedAt,
    updatedAt,
    deleted: Boolean(raw.deleted),
  }
}

export class PropertiesStore extends SyncStore {
  constructor(file, photosDir) {
    super(file, sanitizeProperty)
    this.photosDir = photosDir
  }

  photoDir(agency, propertyId) {
    return path.join(this.photosDir, String(agency), propertyId)
  }

  photoPath(agency, propertyId, photoId) {
    return path.join(this.photoDir(agency, propertyId), `${photoId}.jpg`)
  }

  /** True when the property exists (not deleted) and lists this photo id. */
  hasPhotoRef(agency, propertyId, photoId) {
    const p = this.get(agency, propertyId)
    return Boolean(p && !p.deleted && p.photos.some((ph) => ph.id === photoId))
  }

  async savePhoto(agency, propertyId, photoId, buffer) {
    const dir = this.photoDir(agency, propertyId)
    await mkdir(dir, { recursive: true })
    const target = this.photoPath(agency, propertyId, photoId)
    const tmp = `${target}.tmp`
    await writeFile(tmp, buffer)
    await rename(tmp, target)
  }

  async photoExists(agency, propertyId, photoId) {
    try {
      return (await stat(this.photoPath(agency, propertyId, photoId))).isFile()
    } catch {
      return false
    }
  }

  /** Which of the property's photos are already stored on disk. */
  async storedPhotoIds(agency, propertyId) {
    try {
      const files = await readdir(this.photoDir(agency, propertyId))
      return files.filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4))
    } catch {
      return []
    }
  }

  /** Remove photo files no longer referenced by the property (or all files if it was deleted). */
  async pruneOrphanPhotos(agency, propertyId) {
    const p = this.get(agency, propertyId)
    const keep = new Set(p && !p.deleted ? p.photos.map((ph) => ph.id) : [])
    for (const id of await this.storedPhotoIds(agency, propertyId)) {
      if (!keep.has(id)) await rm(this.photoPath(agency, propertyId, id), { force: true })
    }
    if (!keep.size) await rm(this.photoDir(agency, propertyId), { recursive: true, force: true })
  }
}
