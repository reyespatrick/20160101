/**
 * Hosts a listing photo so Inmovilla can download it by URL. Uploads go to Supabase Storage
 * rather than a local disk, so nothing depends on a server's filesystem surviving a deploy.
 *
 * Behind the write lock: a photo only exists to be pushed to Inmovilla.
 */
import { authenticate, requireWrite } from '../_shared/auth.js'
import { guard, json } from '../_shared/http.js'

const BUCKET = 'property-photos'
const MAX_BYTES = 8 * 1024 * 1024
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export const onRequestPut = guard(async (context) => {
  const session = await authenticate(context)
  if (session.response) return session.response
  const denied = requireWrite(session)
  if (denied) return denied

  const type = (context.request.headers.get('content-type') || '').split(';')[0].trim()
  const extension = TYPES[type] || 'jpg'
  const body = await context.request.arrayBuffer()
  if (!body.byteLength) return json({ error: 'Foto vacía' }, 400)
  if (body.byteLength > MAX_BYTES) return json({ error: 'Foto demasiado grande' }, 413)

  // Scoped by agency so one agency's photos are never mixed with another's.
  const id = crypto.randomUUID().replace(/-/g, '')
  const path = `${session.agency.id}/${id}.${extension}`
  const url = await session.data.client.storage.upload(BUCKET, path, body, type || 'image/jpeg')
  return json({ id, url })
})
