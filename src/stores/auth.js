import { defineStore } from 'pinia'
import { login as apiLogin } from '../api/clients'

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
    token: '',
    tokenExpiresAt: 0,
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
          this.token = saved.token || ''
          this.tokenExpiresAt = Number(saved.tokenExpiresAt) || 0
          this.remember = store === window.localStorage
          return
        } catch {
          /* ignore corrupt storage */
        }
      }
    },
    persist() {
      const payload = JSON.stringify({
        numagencia: this.numagencia,
        password: this.password,
        idioma: this.idioma,
        token: this.token,
        tokenExpiresAt: this.tokenExpiresAt,
      })
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
     * Validate the agency number + API key against Inmovilla (through /api/login) and
     * keep the session token used by the clients API. Throws ApiError on failure.
     */
    async login({ numagencia, password, idioma = 1, remember = true }) {
      const credentials = { numagencia: String(numagencia).trim(), password: String(password).trim(), idioma: Number(idioma) || 1 }
      const session = await apiLogin(credentials)
      this.numagencia = credentials.numagencia
      this.password = credentials.password
      this.idioma = credentials.idioma
      this.token = session.token
      this.tokenExpiresAt = Number(session.expiresAt) || 0
      this.remember = remember
      this.persist()
    },
    /** Silently refresh the token with the stored credentials (used when the server says 401). */
    async refreshToken() {
      if (!this.isAuthenticated) return false
      try {
        const session = await apiLogin(this.credentials)
        this.token = session.token
        this.tokenExpiresAt = Number(session.expiresAt) || 0
        this.persist()
        return true
      } catch {
        return false
      }
    },
    logout() {
      this.numagencia = ''
      this.password = ''
      this.token = ''
      this.tokenExpiresAt = 0
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
