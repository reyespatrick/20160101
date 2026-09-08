/**
 * Supabase client for the browser. It is used for **authentication only** — the publishable
 * key holds no privilege on any table, and every piece of business data goes through the
 * relay's /api routes, which check the role and the agency write lock server side.
 *
 * "Remember me" chooses where the session is kept: localStorage survives a browser restart,
 * sessionStorage disappears with the tab.
 */
import { createClient } from '@supabase/supabase-js'

const REMEMBER_KEY = 'immoba.remember'

export const isRemembered = () => {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) !== '0'
  } catch {
    return true
  }
}
export function setRemember(remember) {
  try {
    window.localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}

/** Routes the session to local or session storage, and never throws if storage is blocked. */
const storage = {
  getItem: (key) => {
    try {
      return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key, value) => {
    try {
      const target = isRemembered() ? window.localStorage : window.sessionStorage
      const other = isRemembered() ? window.sessionStorage : window.localStorage
      target.setItem(key, value)
      other.removeItem(key)
    } catch {
      /* storage unavailable */
    }
  },
  removeItem: (key) => {
    try {
      window.localStorage.removeItem(key)
      window.sessionStorage.removeItem(key)
    } catch {
      /* storage unavailable */
    }
  },
}

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/** Null when the build carries no Supabase configuration, so the app can still say so cleanly. */
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'immoba.auth' },
      })
    : null

export const supabaseConfigured = Boolean(supabase)
