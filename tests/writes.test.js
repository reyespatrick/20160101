/**
 * Every write must go through the relay, and the relay is what enforces the agency lock.
 *
 * The client cannot be trusted to remember that — a single `fetch('/api/rest/...', {method:'POST'})`
 * dropped into a view would look perfectly ordinary in review and would still be guarded, because
 * the guard is on the server. What this pins is narrower and more useful: that there is exactly
 * one door, so the list of writes the app can issue stays knowable by reading one file.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.(js|vue)$/.test(name)) files.push(path)
  }
}
walk('src')

describe('writes to Inmovilla', () => {
  it('all leave through the one REST client', () => {
    const strays = files.filter((f) => !f.endsWith('api/inmovillaRest.js') && /fetch\(\s*[`'"]\/api\/rest/.test(readFileSync(f, 'utf8')))
    expect(strays).toEqual([])
  })

  it('are the ones we think they are', () => {
    const source = readFileSync('src/api/inmovillaRest.js', 'utf8')
    const calls = [...source.matchAll(/restRequest\(\s*([^,]+),\s*\{\s*method:\s*'(POST|PUT|DELETE)'/g)].map((m) => `${m[2]} ${m[1].trim()}`)
    expect(new Set(calls)).toEqual(
      new Set([
        'POST PATHS.clients',
        'PUT PATHS.clients',
        'DELETE `${PATHS.clients}${encodeURIComponent(codCli)}`',
        'POST PATHS.properties',
        'POST PATHS.owners',
        'PUT PATHS.owners',
        'DELETE `${PATHS.owners}${encodeURIComponent(codCli)}`',
        'POST PATHS.followUps',
      ]),
    )
  })

  it('never delete a listing — a withdrawn one is marked unavailable instead', () => {
    const source = readFileSync('src/api/inmovillaRest.js', 'utf8')
    expect(source).not.toMatch(/method:\s*'DELETE'[^}]*propiedades|PATHS\.properties[^)]*'DELETE'/)
    expect(readFileSync('src/stores/localProperties.js', 'utf8')).toMatch(/unavailable/)
  })
})
