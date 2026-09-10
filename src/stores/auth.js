import { defineStore } from 'pinia'
import { accountStatus, getAgency, me as apiMe, signup as apiSignup, updateAgency } from '../api/accounts'
import { setDataLanguage } from '../api/inmovilla'
import { setRemember, supabase, supabaseConfigured } from '../api/supabase'
import { setSessionToken, setUnauthorizedHandler } from '../api/session'

/**
 * The user's session. People sign in against Supabase Auth, which owns passwords and resets;
 * the role, the agency and its write lock come from the relay, which is the only place that
 * can be trusted about them. The Inmovilla keys never reach the phone at all.
 */
export const ROLES = [
  { value: 'admin', labelKey: 'roles.admin' },
  { value: 'agent', labelKey: 'roles.agent' },
  { value: 'readonly', labelKey: 'roles.readonly' },
]

/** Cached user/agency so the app can paint immediately and work offline. */
const PROFILE_KEY = 'immoba.profile'
const readProfile = () => {
  try {
    return JSON.parse(window.localStorage.getItem(PROFILE_KEY) || 'null')
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: '',
    user: null, // { id, email, name, role, active }
    agency: null, // { id, name, numagencia, idioma, hasKeys, hasAnthropic, readOnly }
    remember: true,
    restored: false,
    ready: null, // promise resolved once the stored session has been read
    needsSetup: null,
    sessionExpired: false,
    offlineSession: false, // signed in before, no network now: the app opens on what it remembers
    networkWatch: null, // the listener that turns an offline start into a real session
    configError: supabaseConfigured ? '' : 'La aplicación no está configurada (falta Supabase)',
  }),
  getters: {
    /**
     * A signed-in session, or the memory of one. Supabase keeps the tokens on the device, but an
     * expired one can only be renewed over the network — and an agent standing in a village with
     * no data must not be thrown back to a login screen they cannot use. So a cached profile is
     * enough to open the app; every call still fails without a token, and the write lock stays
     * shut, so nothing can be sent on the strength of a memory.
     */
    isAuthenticated: (s) => Boolean((s.token || s.offlineSession) && s.user),
    role: (s) => s.user?.role || 'readonly',
    isAdmin: (s) => s.user?.role === 'admin',
    roleCanWrite: (s) => s.user?.role === 'admin' || s.user?.role === 'agent',
    /**
     * Agency-wide write lock, on by default and enforced by the relay. Unknown (old session,
     * offline restore) counts as locked so the app never offers a write it cannot make.
     */
    writesLocked: (s) => s.agency?.readOnly !== false,
    canWrite() {
      return this.roleCanWrite && !this.writesLocked
    },
    canDelete() {
      return this.user?.role === 'admin' && !this.writesLocked
    },
    /**
     * Drafting on the device writes nothing to Inmovilla, so neither the agency write lock nor a
     * missing REST key should hide the create buttons — only the role does. Sending is what stays
     * gated: canWrite covers that, and the relay refuses a locked write regardless.
     */
    canDraft() {
      return this.roleCanWrite
    },
    /** Valuations only read from Inmovilla, so the write lock does not apply to them. */
    canEstimate() {
      return this.roleCanWrite
    },
    /**
     * apiweb (listing, ficha, comparables) and the REST API (everything written) are separate.
     *
     * An agent is never told whether they are configured — that is an administrator's business,
     * and nobody is enrolled before it is done — so the flags simply do not reach them. Absent
     * therefore means "not my business", not "missing": only an explicit `false`, which only an
     * administrator ever receives, holds a feature back.
     */
    hasApiweb: (s) => s.agency?.hasApiweb !== false,
    hasRest: (s) => s.agency?.hasRest !== false,
    hasKeys: (s) => s.agency?.hasApiweb !== false || s.agency?.hasRest !== false,
    hasAnthropic: (s) => s.agency?.hasAnthropic !== false,
    numagencia: (s) => s.agency?.numagencia || (s.agency ? `agency-${s.agency.id}` : ''),
    idioma: (s) => s.agency?.idioma || 1,
  },
  actions: {
    /** Reads the stored Supabase session once; every caller awaits the same promise. */
    restore() {
      if (this.ready) return this.ready
      this.ready = (async () => {
        setUnauthorizedHandler(() => this.expire())
        if (!supabase) return
        supabase.auth.onAuthStateChange((event, session) => {
          this.applyToken(session?.access_token || '')
          if (event === 'SIGNED_OUT') this.clearProfile()
        })
        const cached = readProfile()
        if (cached) {
          this.user = cached.user
          this.agency = cached.agency
          setDataLanguage(this.idioma)
        }
        const { data } = await supabase.auth.getSession().catch(() => ({ data: null }))
        this.applyToken(data?.session?.access_token || '')
        if (this.token) {
          this.refresh() // role, keys or lock may have changed since last time
        } else if (this.user) {
          // No usable token. Offline that means "not now"; online it means the session is over.
          this.offlineSession = typeof navigator !== 'undefined' && navigator.onLine === false
          if (this.offlineSession) this.watchForNetwork()
        }
      })().finally(() => {
        this.restored = true
      })
      return this.ready
    },
    applyToken(token) {
      this.token = token || ''
      setSessionToken(this.token)
      if (this.token) {
        this.sessionExpired = false
        this.offlineSession = false
      }
    },

    /**
     * Renew the session the moment there is a network again, so an offline start turns into a
     * real one without the agent doing anything. Registered once; Supabase refreshes the token
     * on its own from there.
     */
    watchForNetwork() {
      if (this.networkWatch) return
      this.networkWatch = async () => {
        if (!supabase || this.token) return
        const { data } = await supabase.auth.getSession().catch(() => ({ data: null }))
        this.applyToken(data?.session?.access_token || '')
        if (this.token) this.refresh()
      }
      window.addEventListener('online', this.networkWatch)
    },
    persist() {
      try {
        window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ user: this.user, agency: this.agency }))
      } catch {
        /* storage unavailable */
      }
    },
    clearProfile() {
      this.user = null
      this.agency = null
      try {
        window.localStorage.removeItem(PROFILE_KEY)
      } catch {
        /* storage unavailable */
      }
    },
    /** Loads the profile the relay reports for the current token. */
    async loadProfile() {
      const { user, agency } = await apiMe()
      this.user = user
      this.agency = agency
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
      if (!supabase) throw new Error(this.configError)
      this.remember = remember
      setRemember(remember)
      const { data, error } = await supabase.auth.signInWithPassword({ email: String(email).trim(), password })
      if (error) throw Object.assign(new Error(error.message), { status: error.status || 401 })
      this.applyToken(data.session?.access_token || '')
      try {
        await this.loadProfile()
      } catch (err) {
        await supabase.auth.signOut().catch(() => {})
        this.applyToken('')
        throw err
      }
    },
    /** Creates the agency and its first administrator, then adopts the session it returns. */
    async signup(data) {
      if (!supabase) throw new Error(this.configError)
      setRemember(true)
      this.remember = true
      const created = await apiSignup(data)
      if (created.access_token && created.refresh_token) {
        await supabase.auth.setSession({ access_token: created.access_token, refresh_token: created.refresh_token })
      }
      this.applyToken(created.access_token || '')
      this.user = created.user
      this.agency = created.agency
      setDataLanguage(this.idioma)
      this.persist()
      this.needsSetup = false
    },
    /** Refresh user/agency from the server. Silent on failure so it never breaks a screen. */
    async refresh() {
      if (!this.token) return
      try {
        await this.loadProfile()
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
    /** Admin only: set the agency's Inmovilla and Anthropic keys (verified by the server). */
    async saveAgencyKeys(data) {
      const { agency } = await updateAgency(data)
      this.agency = { ...this.agency, ...agency }
      setDataLanguage(this.idioma)
      this.persist()
      return agency
    },
    /** Admin only: turn the agency's write lock on or off. */
    async setReadOnly(readOnly) {
      const { agency } = await updateAgency({ readOnly: Boolean(readOnly) })
      this.agency = { ...this.agency, ...agency }
      this.persist()
      return agency
    },
    expire() {
      this.sessionExpired = true
      this.logout({ keepFlag: true })
    },
    async logout({ keepFlag = false } = {}) {
      if (!keepFlag) this.sessionExpired = false
      // A deliberate sign-out ends the offline entry too: there is nothing left to remember.
      this.offlineSession = false
      this.applyToken('')
      this.clearProfile()
      if (supabase) await supabase.auth.signOut().catch(() => {})
    },
  },
})
