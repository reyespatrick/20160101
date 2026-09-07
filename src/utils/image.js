/**
 * Resize a picked image on the device before storing/uploading it.
 * Keeps memory and bandwidth low on phones; EXIF orientation is honoured by the browser decoder.
 */
const MAX_EDGE = 1600
const QUALITY = 0.82

async function decode(file) {
  if (globalThis.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall through to <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen'))
    }
    img.src = url
  })
}

/**
 * @param {File|Blob} file
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function resizeImage(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  const source = await decode(file)
  const sw = source.width || source.naturalWidth
  const sh = source.height || source.naturalHeight
  const scale = Math.min(1, maxEdge / Math.max(sw, sh))
  const width = Math.max(1, Math.round(sw * scale))
  const height = Math.max(1, Math.round(sh * scale))
  const canvas = globalThis.OffscreenCanvas ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0, width, height)
  if (source.close) source.close()
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
    : await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('No se pudo procesar la imagen')
  return { blob, width, height }
}

export function isImageFile(file) {
  return Boolean(file && (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')))
}
