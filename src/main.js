import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { i18n, setLocale, t } from './i18n'
import router from './router'
import { useNotificationsStore } from './stores/notifications'
import { useSettingsStore } from './stores/settings'
import './styles.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia).use(router).use(i18n)

// Language and theme are applied before the first render
const settings = useSettingsStore(pinia)
settings.restore()
setLocale(settings.locale)
settings.$subscribe(() => setLocale(settings.locale))

// Never let an unexpected error take the app down: log it and tell the user.
const notifications = useNotificationsStore(pinia)
const report = (err, where) => {
  console.error(`[${where}]`, err)
  const msg = err?.message || String(err)
  if (/ResizeObserver|Script error/.test(msg)) return
  notifications.error(t('common.failed', { where }))
}
app.config.errorHandler = (err, _instance, info) => report(err, info || 'vue')
window.addEventListener('error', (e) => report(e.error || e.message, 'window'))
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault()
  report(e.reason, 'promise')
})

app.mount('#app')
