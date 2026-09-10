/**
 * "The network is not there — I will try again the moment it is."
 *
 * Screens that can only exist online (the Inmovilla listing, a ficha, a contact search) used to
 * show whatever error the failed request produced, and then sit there. An agent walking out of a
 * basement had to know to pull the page down again. This watches the connection instead and
 * replays the load once it is back — but only while the screen is on view, because retrying a
 * page nobody is looking at is how you burn through apiweb's sixty calls a minute.
 */
import { onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'

export function useOnlineRetry(load) {
  const online = ref(typeof navigator === 'undefined' || navigator.onLine !== false)
  let watching = false

  const onOnline = () => {
    online.value = true
    load()
  }
  const onOffline = () => {
    online.value = false
  }

  function start() {
    if (watching) return
    watching = true
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
  }
  function stop() {
    if (!watching) return
    watching = false
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }

  onMounted(start)
  onUnmounted(stop)
  onActivated(start)
  onDeactivated(stop)

  return { online, retry: load }
}

/** A failed request that failed for want of a network rather than for a reason. */
export function isNetworkError(err) {
  if (!err) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return err.status === 0 || err.status === 504 || /network|fetch|conexión|connexion/i.test(String(err.message || ''))
}
