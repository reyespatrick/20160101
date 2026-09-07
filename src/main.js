import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles.css'

import { useNotificationsStore } from './stores/notifications'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia).use(router)

// Never let an unexpected error take the app down: log it and tell the user.
const notifications = useNotificationsStore(pinia)
const report = (err, where) => {
  console.error(`[${where}]`, err)
  const msg = err?.message || String(err)
  if (/ResizeObserver|Script error/.test(msg)) return
  notifications.error(`Algo ha fallado (${where}). La app sigue funcionando.`)
}
app.config.errorHandler = (err, _instance, info) => report(err, info || 'vue')
window.addEventListener('error', (e) => report(e.error || e.message, 'window'))
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault()
  report(e.reason, 'promise')
})

app.mount('#app')
