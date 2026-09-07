import { defineStore } from 'pinia'

/** App-wide, non-blocking messages (toasts) and the "something went wrong" state. */
export const useNotificationsStore = defineStore('notifications', {
  state: () => ({ toasts: [], lastError: '' }),
  actions: {
    notify(message, { kind = 'info', timeout = 3500 } = {}) {
      const id = Date.now() + Math.random()
      this.toasts.push({ id, message, kind })
      if (timeout) setTimeout(() => this.dismiss(id), timeout)
      return id
    },
    error(message) {
      this.lastError = message
      return this.notify(message, { kind: 'error', timeout: 6000 })
    },
    dismiss(id) {
      this.toasts = this.toasts.filter((t) => t.id !== id)
    },
  },
})
