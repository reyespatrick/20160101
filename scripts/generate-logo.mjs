/**
 * Draws the app's logo, from which every icon is generated (see generate-icons.mjs).
 *
 * It is code rather than a design file so that a rename is one command: the previous wordmark was
 * baked into a PNG nobody could edit. Same house, same two colours; only the word changes.
 *
 * Run: node scripts/generate-logo.mjs && npm run icons
 */
import sharp from 'sharp'
import { writeFile } from 'node:fs/promises'

const WORD = process.argv[2] || 'INMO'
const TAGLINE = process.argv[3] || 'INMOVILLA MÓVIL'
const BRAND = '#2e3192'
const ACCENT = '#f39200'
const MUTED = '#6b6e85'
// Avenir Next is the closest thing on a Mac to the geometric sans the mark was drawn in.
const FONT = "'Avenir Next', 'Avenir', 'Helvetica Neue', Helvetica, sans-serif"

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="#ffffff"/>
  <g fill="none" stroke="${BRAND}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round">
    <path d="M205 168 L320 62 L435 168"/>
    <path d="M240 150 L240 248 L400 248 L400 150"/>
  </g>
  <path d="M296 250 L296 196 Q296 188 304 188 L336 188 Q344 188 344 196 L344 250 Z" fill="${BRAND}"/>
  <circle cx="470" cy="80" r="28" fill="${ACCENT}"/>
  <text x="320" y="352" text-anchor="middle" font-family="${FONT}" font-size="104" font-weight="700" letter-spacing="2" fill="${BRAND}">${WORD}</text>
  <text x="320" y="404" text-anchor="middle" font-family="${FONT}" font-size="25" font-weight="500" letter-spacing="7" fill="${MUTED}">${TAGLINE}</text>
</svg>`

await writeFile('screen/logo.svg', svg)
await sharp(Buffer.from(svg)).png().toFile('screen/splash.png')
console.log(`logo written: screen/splash.png — "${WORD}"`)
