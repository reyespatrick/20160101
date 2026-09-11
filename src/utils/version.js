/**
 * Which build of the app is running.
 *
 * Injected by Vite at build time (see vite.config.js): the version from package.json, the build
 * number — the repository's commit count, which goes up on its own — the commit it was built from
 * and when. An agent reporting something odd can read one line and it names the exact code.
 */
export const APP_VERSION = typeof __APP_VERSION__ === 'undefined' ? { version: '0.0.0', build: '', commit: '', builtAt: '' } : __APP_VERSION__

/** "0.4.0 (143)" — the short form, for a footer or a heading. */
export function versionLabel() {
  return APP_VERSION.build ? `${APP_VERSION.version} (${APP_VERSION.build})` : APP_VERSION.version
}

/** "0.4.0 (143) · 59c4a9e · 11/09/2026" — the whole truth, for a support conversation. */
export function versionDetail(locale = 'es') {
  const parts = [versionLabel()]
  if (APP_VERSION.commit) parts.push(APP_VERSION.commit)
  if (APP_VERSION.builtAt) parts.push(new Date(APP_VERSION.builtAt).toLocaleDateString(locale))
  return parts.join(' · ')
}
