<script setup>
import { useI18n } from 'vue-i18n'
import { onErrorCaptured, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
const { t } = useI18n()

/**
 * Catches render/lifecycle errors of the current screen and shows a recoverable panel
 * instead of a blank page. Errors are also reported to the console for debugging.
 */
const error = ref(null)
const route = useRoute()
onErrorCaptured((err, _instance, info) => {
  console.error('[screen error]', info, err)
  error.value = { message: err?.message || String(err), info }
  return false // stop propagation; the app shell stays alive
})
watch(() => route.fullPath, () => (error.value = null))
function retry() {
  error.value = null
}
function reload() {
  window.location.reload()
}
</script>

<template>
  <div v-if="error" class="boundary">
    <div class="panel">
      <div class="icon">⚠️</div>
      <h2>{{ t('common.errorTitle') }}</h2>
      <p class="muted">{{ t('common.errorBody') }}</p>
      <details><summary>{{ t('common.errorDetails') }}</summary><pre>{{ error.message }}</pre></details>
      <div class="actions">
        <button type="button" class="btn" @click="retry">{{ t('common.retry') }}</button>
        <RouterLink to="/" class="btn btn-ghost">{{ t('common.home') }}</RouterLink>
        <button type="button" class="btn btn-ghost" @click="reload">{{ t('common.reload') }}</button>
      </div>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.boundary { padding: 2rem 1rem; display: grid; place-items: center; }
.panel { max-width: 460px; width: 100%; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1.5rem; text-align: center; display: flex; flex-direction: column; gap: 0.6rem; align-items: center; }
.icon { font-size: 2.2rem; }
h2 { margin: 0; }
p { margin: 0; }
details { width: 100%; text-align: left; font-size: 0.8rem; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); padding: 0.6rem; border-radius: 8px; }
.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; margin-top: 0.5rem; }
</style>
