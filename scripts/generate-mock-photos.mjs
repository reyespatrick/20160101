// Renders the twelve fake "property photos" (server/mockPhoto.js) to JPEG for the local relay.
import sharp from 'sharp'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { MOCK_PHOTO_COUNT, scene } from '../server/mockPhoto.js'

const OUT = process.env.MOCK_PHOTOS_DIR || path.join(process.cwd(), 'data', 'mock-photos')
// `--if-missing` (used by `npm run dev:mock`) skips the work when the photos already exist
if (process.argv.includes('--if-missing') && existsSync(path.join(OUT, `${MOCK_PHOTO_COUNT}.jpg`))) process.exit(0)
await mkdir(OUT, { recursive: true })

for (let i = 1; i <= MOCK_PHOTO_COUNT; i++) {
  await sharp(Buffer.from(scene(i))).jpeg({ quality: 82 }).toFile(path.join(OUT, `${i}.jpg`))
}
console.log(`${MOCK_PHOTO_COUNT} mock photos written to`, OUT)
