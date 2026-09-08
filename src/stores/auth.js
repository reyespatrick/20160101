import { defineStore } from 'pinia'
import { accountStatus, getAgency, login as apiLogin, me as apiMe, signup as apiSignup, updateAgency } from '../api/accounts'
import { setDataLanguage } from '../api/inmovilla'
import { setSessionToken, setUnauthorizedHandler } from '../api/session'

/**
 * The user's session (email/password account on the relay). The Inmovilla keys belong
 * to the agency and stay on the server; the phone only knows whether they are set.
 */
const STORAGE_KEY = 'immoba.session'

export const ROLES = [
  { value: 'admin', labelKey: 'roles.admin' },
  { value: 'agent', labelKey: 'roles.agent' },
  { value: 'readonly', labelKey: 'roles.readonly' },
]

function storages() {
  return [window.localStorage, window.sessionStorage]
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: '',
    user: null, // { id, email, name, role }
    agency: null, // { id, name, numagencia, idioma, hasKeys }
    remember: true,
    restored: false,
    needsSetup: null, // null = unknown yet
    sessionExpired: false,
  }),
  getters: {
    isAuthenticated: (s) => Boolean(s.token && s.user),
    role: (s) => s.user?.role || 'readonly',
    isAdmin: (s) => s.user?.role === 'admin',
    canWrite: (s) => s.user?.role === 'admin' || s.user?.role === 'agent',
    canDelete: (s) => s.user?.role === 'admin',
    hasKeys: (s) => Boolean(s.agency?.hasKeys),
    hasAnthropic: (s) => Boolean(s.agency?.hasAnthropic),
    numagencia: (s) => s.agency?.numagencia || (s.agency ? `agency-${s.agency.id}` : ''),
    idioma: (s) => s.agency?.idioma || 1,
  },
  actions: {
    restore() {
      if (this.restored) return
      this.restored = true
      setUnauthorizedHandler(() => this.expire())
      for (const store of storages()) {
        try {
          const raw = store.getItem(STORAGE_KEY)
          if (!raw) continue
          const saved = JSON.parse(raw)
          this.token = saved.token || ''
          this.user = saved.user || null
          this.agency = saved.agency || null
          this.remember = store === window.localStorage
          break
        } catch {
          /* ignore corrupt storage */
        }
      }
      setSessionToken(this.token)
      setDataLanguage(this.idioma)
    },
    persist() {
      const payload = JSON.stringify({ token: this.token, user: this.user, agency: this.agency })
      const target = this.remember ? window.localStorage : window.sessionStorage
      const other = this.remember ? window.sessionStorage : window.localStorage
      try {
        target.setItem(STORAGE_KEY, payload)
        other.removeItem(STORAGE_KEY)
      } catch {
        /* storage unavailable */
      }
    },
    applySession(session, remember = this.remember) {
      this.token = session.token
      this.user = session.user
      this.agency = session.agency
      this.remember = remember
      this.sessionExpired = false
      setSessionToken(this.token)
      setDataLanguage(this.idioma)
      this.persist()
    },
    async checkStatus() {
      try {
        const s = await accountStatus()
        this.needsSetup = Boolean(s.needsSetup)
        return s
      } catch {
        this.needsSetup = false
        return null
      }
    },
    async login({ email, password, remember = true }) {
      this.applySession(await apiLogin(String(email).trim(), password), remember)
    },
    async signup(data) {
      this.applySession(await apiSignup(data), true)
      this.needsSetup = false
    },
    /** Refresh user/agency from the server (role or keys may have changed). Silent on failure. */
    async refresh() {
      if (!this.token) return
      try {
        const session = await apiMe()
        this.user = session.user
        this.agency = session.agency
        setDataLanguage(this.idioma)
        this.persist()
      } catch (err) {
        if (err.code === 'session') this.expire()
      }
    },
    async refreshAgency() {
      const { agency } = await getAgency()
      this.agency = { ...this.agency, ...agency }
      setDataLanguage(this.idioma)
      this.persist()
      return agency
    },
    /** Admin only: set the agency's Inmovilla keys (verified by the server). */
    async saveAgencyKeys(data) {
      const { agency } = await updateAgency(data)
      this.agency = { ...this.agency, ...agency }
      setDataLanguage(this.idioma)
      this.persist()
      return agency
    },
    expire() {
      this.sessionExpired = true
      this.logout({ keepFlag: true })
    },
    logout({ keepFlag = false } = {}) {
      this.token = ''
      this.user = null
      this.agency = null
      if (!keepFlag) this.sessionExpired = false
      setSessionToken('')
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
