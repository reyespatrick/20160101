import { chromium } from 'playwright-core'
const base = 'http://localhost:8788'
const OUT = process.env.OUT
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const shot = async (name, opts = {}) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${name}.png`, ...opts }); console.log('  ✓', name) }
const photo = (n) => `data/mock-photos/${n}.jpg`

// ---------- écran 1 : alta ----------
await page.goto(base + '/setup'); await page.waitForSelector('#email')
await page.fill('#name', 'Ana García'); await page.fill('#email', 'ana@inmobiliaria-demo.es'); await page.fill('#password', 'password1')
await shot('01-alta')
await page.click('button[type=submit]'); await page.waitForURL(/perfil\/claves/, { timeout: 20000 }); await page.waitForSelector('#num')

// ---------- écran 2 : claves ----------
await page.fill('#num', '1234'); await page.fill('#apiweb', 'demo'); await page.fill('#rest', 'demo-token'); await page.fill('#anthropic', 'sk-ant-demo')
await shot('02-claves-vacias', { fullPage: true })
await page.click('button[type=submit]'); await page.waitForURL((u) => u.pathname === '/', { timeout: 25000 })
await page.waitForSelector('.card')
await page.goto(base + '/perfil/claves'); await page.waitForSelector('.lock .btn')
await shot('03-claves', { fullPage: true })

// ---------- lever le verrou pour montrer les écrans d'escritura ----------
await page.click('.lock .btn'); await page.waitForFunction(() => !document.querySelector('.lock.on'), null, { timeout: 15000 })

// ---------- écran : usuarios ----------
await page.goto(base + '/perfil/usuarios'); await page.waitForSelector('.container')
await page.click('button:has-text("Añadir usuario")'); await page.waitForSelector('#uname')
await page.fill('#uname', 'Bea Ruiz'); await page.fill('#uemail', 'bea@inmobiliaria-demo.es'); await page.fill('#upass', 'password2')
await page.selectOption('#urole', 'agent')
await page.click('form.form button[type=submit]'); await page.waitForSelector('.user-row, li', { timeout: 15000 }).catch(() => {})
await page.waitForTimeout(1500)
await shot('04-usuarios', { fullPage: true })

// ---------- semer des données ----------
const newClient = async (nombre, apellidos, movil, email) => {
  await page.goto(base + '/clientes/nuevo'); await page.waitForSelector('#name')
  await page.fill('#name', nombre); await page.fill('#surname', apellidos); await page.fill('#mobile', movil)
  await page.fill('#email', email).catch(() => {})
  await page.click('button[type=submit]'); await page.waitForURL(/clientes\/(?!nuevo)/, { timeout: 20000 })
}
await newClient('Lucía', 'Fernández', '600111222', 'lucia@example.es')
await newClient('Javier', 'Moreno', '600333444', 'javier@example.es')
await newClient('Marta', 'Sanz', '600555666', 'marta@example.es')
console.log('  · 3 clientes creados')

// seguimientos
const newFollowUp = async (asunto, dias) => {
  const d = new Date(Date.now() + dias * 86400000)
  d.setHours(10 + dias, 0, 0, 0)
  await page.goto(base + '/agenda/nuevo'); await page.waitForSelector('#subject')
  await page.fill('#subject', asunto)
  await page.fill('#remind', d.toISOString().slice(0, 16))
  await page.click('button[type=submit]'); await page.waitForURL(/agenda(\?|$)/, { timeout: 20000 })
}
await newFollowUp('Llamar a Lucía por el piso de Alicante', 0)
await newFollowUp('Visita con Javier en Elche', 2)
await newFollowUp('Enviar documentación a Marta', 5)
console.log('  · 3 seguimientos creados')

// propiedad propia con fotos
await page.goto(base + '/mis-propiedades/nueva'); await page.waitForSelector('#ref')
await page.fill('#ref', 'APP-' + Date.now().toString(36).slice(-5).toUpperCase())
await page.selectOption('#type', { label: 'Piso' })
await page.fill('.city input', 'alic'); await page.waitForSelector('.results li'); await page.click('.results li:has-text("Alicante")')
await page.fill('#price', '198000'); await page.fill('#built', '96'); await page.fill('#bedrooms', '3'); await page.fill('#bathrooms', '2')
await page.fill('#title', 'Piso reformado junto al centro')
await page.fill('#description', 'Vivienda exterior muy luminosa, totalmente reformada, con cocina office y terraza orientada al sur. A cinco minutos del mercado y de la parada de tranvía.')
await page.fill('#owner', 'Carmen'); await page.fill('#ownerSurname', 'Ortiz'); await page.fill('#ownerPhone', '600777888')
await page.locator('input[type=file]').first().setInputFiles([photo(3), photo(7), photo(9)])
await page.waitForFunction(() => document.querySelectorAll('.picker .tile img').length === 3, null, { timeout: 20000 })
await shot('05-nueva-propiedad', { fullPage: true })
await page.click('button.save'); await page.waitForSelector('.detail h1', { timeout: 20000 })
await page.waitForFunction(() => document.querySelector('.detail .inmo.ok'), null, { timeout: 40000 }).catch(() => {})
await shot('06-mi-propiedad', { fullPage: true })
console.log('  · propiedad propia creada')

// ---------- propietario ----------
await page.goto(base + '/propietario/nuevo?codOfer=10001&ref=IMB-0001'); await page.waitForSelector('form')
await page.fill('#name', 'Carmen').catch(() => {})
await page.fill('#surname', 'Ortiz').catch(() => {})
await page.fill('#mobile', '600777888').catch(() => {})
await shot('07-propietario', { fullPage: true })

// ---------- listado de Inmovilla ----------
await page.goto(base + '/'); await page.waitForSelector('.card')
await page.waitForFunction(() => [...document.querySelectorAll('.card img')].slice(0, 4).every((i) => i.complete && i.naturalWidth > 0))
await shot('08-propiedades')

// ---------- ficha ----------
await page.click('.card >> nth=0'); await page.waitForSelector('.detail .rows')
await page.waitForFunction(() => { const i = document.querySelector('.gallery img'); return i && i.complete })
await shot('09-ficha', { fullPage: true })

// ---------- valoración ----------
await page.click('.estimate-cta a'); await page.waitForSelector('.hero .value', { timeout: 40000 })
await shot('10-valoracion', { fullPage: true })

// ---------- mis propiedades ----------
await page.goto(base + '/?source=mine'); await page.waitForSelector('.card, .empty')
await shot('11-mis-propiedades')

// ---------- clientes ----------
await page.goto(base + '/clientes'); await page.waitForSelector('.client-card', { timeout: 30000 })
await shot('12-clientes')
await page.locator('.client-card').first().click(); await page.waitForSelector('.client-detail', { timeout: 20000 })
await shot('13-ficha-cliente', { fullPage: true })
await page.goto(base + '/clientes/nuevo'); await page.waitForSelector('#name')
await page.fill('#name', 'Nuevo'); await page.fill('#surname', 'Cliente'); await page.fill('#mobile', '600000123')
await shot('14-nuevo-cliente', { fullPage: true })

// ---------- agenda ----------
await page.goto(base + '/agenda'); await page.waitForSelector('.agenda', { timeout: 20000 }); await page.waitForTimeout(1200)
await shot('15-agenda-lista')
const cal = page.locator('.segments button').nth(1)
if (await cal.count()) { await cal.click(); await page.waitForTimeout(1000); await shot('16-agenda-calendario') }
await page.goto(base + '/agenda/nuevo'); await page.waitForSelector('#subject')
await page.fill('#subject', 'Visita al piso de Alicante')
await shot('17-nuevo-seguimiento', { fullPage: true })

// ---------- perfil ----------
await page.goto(base + '/perfil'); await page.waitForSelector('.profile .segments')
await shot('18-perfil', { fullPage: true })

// ---------- modo oscuro ----------
await page.click('.segments button:has-text("Oscuro")')
await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
await page.goto(base + '/'); await page.waitForSelector('.card')
await page.waitForFunction(() => [...document.querySelectorAll('.card img')].slice(0, 4).every((i) => i.complete))
await shot('19-modo-oscuro')
await page.goto(base + '/perfil'); await page.click('.segments button:has-text("Claro")'); await page.waitForTimeout(400)

console.log('errores JS:', errors.length ? errors : 'ninguno')

// ---------- pantalla de acceso, en una sesión nueva ----------
const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' })
const p2 = await fresh.newPage()
await p2.goto(base + '/login'); await p2.waitForSelector('#email'); await p2.waitForTimeout(700)
await p2.screenshot({ path: `${OUT}/00-acceso.png` }); console.log('  ✓ 00-acceso')
await browser.close()
