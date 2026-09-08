// Generates 12 fake "property photos" (SVG scenes rendered to JPEG) for the mock server.
import sharp from 'sharp'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const OUT = process.env.MOCK_PHOTOS_DIR || path.join(process.cwd(), 'data', 'mock-photos')
// `--if-missing` (used by `npm run dev:mock`) skips the work when the photos already exist
if (process.argv.includes('--if-missing') && existsSync(path.join(OUT, '12.jpg'))) process.exit(0)
await mkdir(OUT, { recursive: true })

const palettes = [
  ['#9ecbff', '#e8f4ff', '#f2e9d8', '#c9885a'],
  ['#ffd39e', '#fff1dc', '#e5e5e5', '#7a8fa6'],
  ['#8fd3ff', '#f0f9ff', '#f7f1e3', '#b86b4b'],
  ['#c7d2fe', '#eef2ff', '#efe7dc', '#8c6a4f'],
  ['#fcd5ce', '#fff5f3', '#ebe6dd', '#5d6d7e'],
  ['#a7f3d0', '#ecfdf5', '#f4efe6', '#a3703f'],
]
function scene(i) {
  const [sky1, sky2, wall, roof] = palettes[i % palettes.length]
  const interior = i % 3 === 2
  if (interior) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
      <rect width="1200" height="800" fill="${sky2}"/>
      <rect y="520" width="1200" height="280" fill="${wall}"/>
      <rect x="80" y="120" width="420" height="330" fill="${sky1}" stroke="#fff" stroke-width="18"/>
      <line x1="290" y1="120" x2="290" y2="450" stroke="#fff" stroke-width="12"/>
      <rect x="620" y="330" width="480" height="200" rx="30" fill="${roof}"/>
      <rect x="640" y="530" width="40" height="120" fill="${roof}"/><rect x="1040" y="530" width="40" height="120" fill="${roof}"/>
      <circle cx="900" cy="180" r="70" fill="#fff" opacity=".8"/>
      <rect x="120" y="600" width="300" height="20" rx="10" fill="#d8cfc0"/>
    </svg>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky1}"/><stop offset="1" stop-color="${sky2}"/></linearGradient></defs>
    <rect width="1200" height="800" fill="url(#g)"/>
    <circle cx="${200 + (i * 90) % 800}" cy="140" r="60" fill="#fff6c2" opacity=".9"/>
    <rect y="620" width="1200" height="180" fill="#9fbf8a"/>
    <rect x="250" y="300" width="700" height="330" fill="${wall}"/>
    <polygon points="220,300 600,${120 + (i % 4) * 30} 980,300" fill="${roof}"/>
    ${[0, 1, 2].map((k) => `<rect x="${310 + k * 220}" y="360" width="120" height="110" fill="${sky1}" stroke="#fff" stroke-width="10"/>`).join('')}
    <rect x="540" y="480" width="120" height="150" fill="${roof}"/>
    <rect x="80" y="560" width="120" height="70" fill="#7aa86a"/><circle cx="140" cy="520" r="70" fill="#6a9a5a"/>
    <rect x="1000" y="560" width="120" height="70" fill="#7aa86a"/><circle cx="1060" cy="520" r="70" fill="#6a9a5a"/>
  </svg>`
}
for (let i = 1; i <= 12; i++) {
  await sharp(Buffer.from(scene(i))).jpeg({ quality: 82 }).toFile(path.join(OUT, `${i}.jpg`))
}
console.log('12 mock photos written to', OUT)
