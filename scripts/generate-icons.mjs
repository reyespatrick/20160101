// Generates PWA icons from screen/splash.png (the Immoba logo).
import sharp from 'sharp'
import { mkdir, copyFile } from 'node:fs/promises'

const SRC = 'screen/splash.png'
const OUT = 'public/icons'
const BRAND = { r: 46, g: 49, b: 146, alpha: 1 }

await mkdir(OUT, { recursive: true })

async function icon(size, file, { padding = 0.1, background = '#ffffff' } = {}) {
  const inner = Math.round(size * (1 - padding * 2))
  const art = await sharp(SRC).resize(inner, inner, { fit: 'contain', background }).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: art, gravity: 'centre' }])
    .png()
    .toFile(`${OUT}/${file}`)
}

await icon(192, 'icon-192.png')
await icon(512, 'icon-512.png')
await icon(512, 'icon-512-maskable.png', { padding: 0.2 })
await icon(180, 'apple-touch-icon.png', { padding: 0.08 })
await sharp(SRC).resize(64, 64, { fit: 'contain', background: '#ffffff' }).png().toFile(`${OUT}/favicon-64.png`)
await copyFile(SRC, 'public/splash.png')
console.log('icons written to', OUT, BRAND)
