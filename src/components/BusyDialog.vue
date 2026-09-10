<script setup>
/**
 * "Hold on, I am asking." A modal that says what is being fetched while it is being fetched.
 *
 * Used when the app catches up on something the agent could not do in the field — reading an
 * address from a position, looking a contact up — because those take seconds against a remote
 * register and a screen that simply sits there looks broken. Always cancellable: a slow answer
 * must never trap anyone in a listing they wanted to read.
 */
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
defineProps({
  open: { type: Boolean, default: false },
  message: { type: String, required: true },
  detail: { type: String, default: '' },
  cancelLabel: { type: String, default: '' },
})
const emit = defineEmits(['cancel'])
</script>

<template>
  <Transition name="busy">
    <div v-if="open" class="backdrop" role="dialog" aria-modal="true" aria-live="polite" :aria-label="message" @keydown.esc="emit('cancel')">
      <div class="panel">
        <div class="spinner" aria-hidden="true"></div>
        <p class="message">{{ message }}</p>
        <p v-if="detail" class="detail muted">{{ detail }}</p>
        <button type="button" class="btn btn-ghost" @click="emit('cancel')">{{ cancelLabel || t('common.cancel') }}</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 55; display: grid; place-items: center; padding: 1.25rem; background: rgba(12, 13, 31, 0.55); backdrop-filter: blur(2px); }
.panel { width: 100%; max-width: 20rem; background: var(--surface); border-radius: var(--radius); box-shadow: 0 18px 48px rgba(12, 13, 31, 0.35); padding: 1.6rem 1.4rem 1.2rem; text-align: center; }
.spinner { width: 34px; height: 34px; margin: 0 auto 1rem; border: 3px solid var(--border); border-top-color: var(--brand); border-radius: 50%; animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.message { margin: 0; font-size: 1rem; font-weight: 600; line-height: 1.45; }
.detail { margin: 0.5rem 0 0; font-size: 0.85rem; line-height: 1.45; }
.panel .btn { margin-top: 1.2rem; min-height: 44px; width: 100%; }
.busy-enter-active, .busy-leave-active { transition: opacity 0.15s ease; }
.busy-enter-from, .busy-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } .busy-enter-active, .busy-leave-active { transition: none; } }
</style>
