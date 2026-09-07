<script setup>
import { useNotificationsStore } from '../stores/notifications'
const n = useNotificationsStore()
</script>

<template>
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in n.toasts" :key="t.id" class="toast" :class="t.kind" role="status" @click="n.dismiss(t.id)">{{ t.message }}</div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts { position: fixed; left: 50%; bottom: calc(var(--nav-height) + 1rem + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 50; display: flex; flex-direction: column; gap: 0.4rem; align-items: center; pointer-events: none; width: min(92vw, 480px); }
.toast { pointer-events: auto; background: var(--text); color: #fff; padding: 0.6rem 1.1rem; border-radius: 999px; font-weight: 600; font-size: 0.9rem; box-shadow: 0 6px 18px rgba(0,0,0,0.25); text-align: center; }
.toast.error { background: var(--danger); }
.toast.success { background: #2e7d32; }
.toast-enter-active, .toast-leave-active { transition: opacity 0.25s, transform 0.25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(10px); }
</style>
