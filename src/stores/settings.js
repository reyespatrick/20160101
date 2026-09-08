import { defineStore } from 'pinia'

/** UI preferences (language, theme) persisted on the device. */
const KEY = 'immoba.settings'
export const LOCALES = [
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
]
export const THEMES = ['auto', 'light', 'dark']

function detectLocale() {
  const nav = (navigator.language || 'es').slice(0, 2).toLowerCase()
  return LOCALES.some((l) => l.value === nav) ? nav : 'es'
}
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

export const useSettingsStore = defineStore('settings', {
  state: () => ({ locale: 'es', theme: 'auto', restored: false, systemDark: Boolean(media?.matches) }),
  getters: {
    resolvedTheme: (s) => (s.theme === 'auto' ? (s.systemDark ? 'dark' : 'light') : s.theme),
  },
  actions: {
    restore() {
      if (this.restored) return
      this.restored = true
      let saved = null
      try {
        saved = JSON.parse(localStorage.getItem(KEY) || 'null')
      } catch {
        /* ignore */
      }
      this.locale = saved?.locale && LOCALES.some((l) => l.value === saved.locale) ? saved.locale : detectLocale()
      this.theme = THEMES.includes(saved?.theme) ? saved.theme : 'auto'
      media?.addEventListener?.('change', (e) => {
        this.systemDark = e.matches
        this.applyTheme()
      })
      this.applyTheme()
    },
    persist() {
      try {
        localStorage.setItem(KEY, JSON.stringify({ locale: this.locale, theme: this.theme }))
      } catch {
        /* ignore */
      }
    },
    setLocale(locale) {
      if (!LOCALES.some((l) => l.value === locale)) return
      this.locale = locale
      this.persist()
    },
    setTheme(theme) {
      if (!THEMES.includes(theme)) return
      this.theme = theme
      this.persist()
      this.applyTheme()
    },
    applyTheme() {
      if (typeof document === 'undefined') return
      const t = this.resolvedTheme
      document.documentElement.dataset.theme = t
      document.documentElement.style.colorScheme = t
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#1c1d33' : '#2e3192')
    },
  },
})
