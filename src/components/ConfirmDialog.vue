<script setup>
/**
 * Centred confirmation for destructive actions.
 *
 * It replaces the inline "question + Oui/Non" row the detail screens used to append at the
 * bottom, which ended up squeezed against the navigation bar and easy to miss — the worst
 * place for a question you cannot undo. Escape and a tap outside both cancel, and the cancel
 * button takes focus so the dangerous answer is never the default.
 */
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const props = defineProps({
  open: { type: Boolean, default: false },
  message: { type: String, required: true },
  detail: { type: String, default: '' },
  confirmLabel: { type: String, default: '' },
  cancelLabel: { type: String, default: '' },
})
const emit = defineEmits(['confirm', 'cancel'])
const cancelButton = ref(null)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    cancelButton.value?.focus()
  },
)
</script>

<template>
  <Transition name="dialog">
    <div v-if="open" class="backdrop" role="dialog" aria-modal="true" :aria-label="message" @click.self="emit('cancel')" @keydown.esc="emit('cancel')">
      <div class="panel">
        <p class="message">{{ message }}</p>
        <p v-if="detail" class="detail muted">{{ detail }}</p>
        <div class="actions">
          <button ref="cancelButton" type="button" class="btn btn-ghost" @click="emit('cancel')">{{ cancelLabel || t('common.no') }}</button>
          <button type="button" class="btn danger-fill" @click="emit('confirm')">{{ confirmLabel || t('common.yes') }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 1.25rem;
  background: rgba(12, 13, 31, 0.55);
  backdrop-filter: blur(2px);
}
.panel {
  width: 100%;
  max-width: 22rem;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: 0 18px 48px rgba(12, 13, 31, 0.35);
  padding: 1.4rem 1.4rem 1.2rem;
  text-align: center;
}
.message { margin: 0; font-size: 1.05rem; font-weight: 600; line-height: 1.45; }
.detail { margin: 0.6rem 0 0; font-size: 0.88rem; line-height: 1.45; }
.actions { display: flex; gap: 0.6rem; margin-top: 1.3rem; }
.actions .btn { flex: 1; min-height: 48px; }
.dialog-enter-active, .dialog-leave-active { transition: opacity 0.15s ease; }
.dialog-enter-active .panel { transition: transform 0.15s ease; }
.dialog-enter-from, .dialog-leave-to { opacity: 0; }
.dialog-enter-from .panel { transform: translateY(8px); }
@media (prefers-reduced-motion: reduce) {
  .dialog-enter-active, .dialog-leave-active, .dialog-enter-active .panel { transition: none; }
}
</style>
