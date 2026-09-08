/** Response helpers shared by every function. Same JSON error shape as the Node relay. */
export const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export const fail = (message, status = 400, code) => json(code ? { error: message, code } : { error: message }, status)

/** Turns a thrown error into the response the app already knows how to read. */
export function errorResponse(err) {
  const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500
  return fail(err?.message || 'Error inesperado', status, err?.code)
}

/** Wraps a handler so an unexpected throw never leaks a stack trace to the client. */
export const guard = (handler) => async (context) => {
  try {
    return await handler(context)
  } catch (err) {
    console.error('[function]', err?.message, err?.details || '')
    return errorResponse(err)
  }
}

export async function readJson(request, limit = 256 * 1024) {
  const text = await request.text()
  if (text.length > limit) throw Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 })
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw Object.assign(new Error('JSON no válido'), { status: 400 })
  }
}
