// Renders the Immoba wordmark (SVG) to screen/splash.png; icons are derived from it by generate-icons.mjs
import sharp from 'sharp'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="#ffffff"/>
  <!-- house mark -->
  <g transform="translate(320 150)">
    <path d="M-110 10 L0 -85 L110 10" fill="none" stroke="#2e3192" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M-80 -12 V95 H80 V-12" fill="none" stroke="#2e3192" stroke-width="22" stroke-linejoin="round"/>
    <rect x="-22" y="35" width="44" height="60" rx="6" fill="#2e3192"/>
    <circle cx="150" cy="-70" r="24" fill="#f39200"/>
  </g>
  <text x="320" y="352" text-anchor="middle" font-family="Verdana, DejaVu Sans, Arial, sans-serif" font-size="96" font-weight="700" letter-spacing="-2" fill="#2e3192">immoba</text>
  <text x="320" y="405" text-anchor="middle" font-family="Verdana, DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="400" letter-spacing="8" fill="#6b6e85">INMOVILLA MÓVIL</text>
</svg>`
await sharp(Buffer.from(svg)).png().toFile('screen/splash.png')
console.log('logo written to screen/splash.png')
