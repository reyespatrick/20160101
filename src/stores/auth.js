import { defineStore } from 'pinia'
import { callInmovilla } from '../api/inmovilla'

const STORAGE_KEY = 'alma.session'

export const LANGUAGES = [
  { value: 1, label: 'Español' },
  { value: 2, label: 'English' },
  { value: 3, label: 'Deutsch' },
  { value: 4, label: 'Français' },
  { value: 5, label: 'Italiano' },
  { value: 6, label: 'Português' },
  { value: 7, label: 'Nederlands' },
  { value: 8, label: 'Русский' },
]

function storages() {
  return [window.localStorage, window.sessionStorage]
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    numagencia: '',
    password: '',
    idioma: 1,
    remember: true,
    restored: false,
  }),
  getters: {
    isAuthenticated: (s) => Boolean(s.numagencia && s.password),
    credentials: (s) => ({ numagencia: s.numagencia, password: s.password, idioma: s.idioma }),
  },
  actions: {
    restore() {
      if (this.restored) return
      this.restored = true
      for (const store of storages()) {
        try {
          const raw = store.getItem(STORAGE_KEY)
          if (!raw) continue
          const saved = JSON.parse(raw)
          this.numagencia = saved.numagencia || ''
          this.password = saved.password || ''
          this.idioma = Number(saved.idioma) || 1
          this.remember = store === window.localStorage
          return
        } catch {
          /* ignore corrupt storage */
        }
      }
    },
    persist() {
      const payload = JSON.stringify({ numagencia: this.numagencia, password: this.password, idioma: this.idioma })
      const target = this.remember ? window.localStorage : window.sessionStorage
      const other = this.remember ? window.sessionStorage : window.localStorage
      try {
        target.setItem(STORAGE_KEY, payload)
        other.removeItem(STORAGE_KEY)
      } catch {
        /* storage unavailable */
      }
    },
    /**
     * Validate the agency number + API key against Inmovilla with a tiny request.
     * Throws ApiError with a readable message on failure.
     */
    async login({ numagencia, password, idioma = 1, remember = true }) {
      const credentials = { numagencia: String(numagencia).trim(), password: String(password).trim(), idioma: Number(idioma) || 1 }
      await callInmovilla(credentials, [{ type: 'paginacion', pos: 1, num: 1, where: '', order: '' }])
      this.numagencia = credentials.numagencia
      this.password = credentials.password
      this.idioma = credentials.idioma
      this.remember = remember
      this.persist()
    },
    logout() {
      this.numagencia = ''
      this.password = ''
      for (const store of storages()) {
        try {
          store.removeItem(STORAGE_KEY)
        } catch {
          /* ignore */
        }
      }
    },
  },
})
