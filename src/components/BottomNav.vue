<script setup>
import { useI18n } from 'vue-i18n'
import { useClientsStore } from '../stores/clients'
import { useLocalPropertiesStore } from '../stores/localProperties'
import { useFollowUpsStore } from '../stores/followUps'
const { t } = useI18n()
const clients = useClientsStore()
const localProperties = useLocalPropertiesStore()
const followUps = useFollowUpsStore()
</script>

<template>
  <nav class="bottom-nav" aria-label="Secciones">
    <RouterLink :to="{ name: 'properties' }" class="tab" active-class="active" :class="{ active: $route.name === 'property' }">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z" /></svg>
      <span>{{ t('nav.properties') }}</span>
      <em v-if="localProperties.pendingCount" class="dot" :title="t('nav.pendingSync', { n: localProperties.pendingCount })">{{ localProperties.pendingCount }}</em>
    </RouterLink>
    <RouterLink :to="{ name: 'followups' }" class="tab" active-class="active" :class="{ active: String($route.name).startsWith('followup') }">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v2H4a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-3V2h-2v2H9V2zM5 9h14v10H5zm2 2v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2zm-8 4v2h2v-2zm4 0v2h2v-2z" /></svg>
      <span>{{ t('nav.agenda') }}</span>
      <em v-if="followUps.dueCount" class="dot due" :title="t('nav.due', { n: followUps.dueCount })">{{ followUps.dueCount }}</em>
      <em v-else-if="followUps.pendingCount" class="dot" :title="t('nav.pendingSync', { n: followUps.pendingCount })">{{ followUps.pendingCount }}</em>
    </RouterLink>
    <RouterLink :to="{ name: 'clients' }" class="tab" active-class="active" :class="{ active: String($route.name).startsWith('client') }">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v2h16v-2c0-3-4-5-8-5z" /></svg>
      <span>{{ t('nav.clients') }}</span>
      <em v-if="clients.pendingCount" class="dot" :title="t('nav.pendingSync', { n: clients.pendingCount })">{{ clients.pendingCount }}</em>
    </RouterLink>
  </nav>
</template>

<style scoped>
.bottom-nav {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  height: var(--nav-height);
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding-bottom: env(safe-area-inset-bottom);
}
.tab {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--muted);
}
.tab svg { width: 24px; height: 24px; fill: currentColor; }
.tab.active { color: var(--brand); }
.dot.due { background: var(--danger); }
.dot {
  position: absolute;
  top: 4px;
  left: calc(50% + 8px);
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font-size: 0.7rem;
  font-style: normal;
  font-weight: 700;
  display: grid;
  place-items: center;
}
</style>
