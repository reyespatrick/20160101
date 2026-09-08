<script setup>
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import InmovillaState from './InmovillaState.vue'
import { fullName, initials, primaryPhone } from '../models/client'
const { t } = useI18n()

const props = defineProps({ client: { type: Object, required: true } })
const c = computed(() => props.client)
const color = computed(() => (c.value.remoteId ? '#2e3192' : '#f39200'))
</script>

<template>
  <RouterLink :to="{ name: 'client', params: { id: c.id } }" class="client-card">
    <div class="avatar" :style="{ background: color }">{{ initials(c) }}</div>
    <div class="info">
      <div class="name">{{ fullName(c) }}</div>
      <div class="meta muted">
        <span v-if="primaryPhone(c)">{{ primaryPhone(c) }}</span>
        <span v-if="primaryPhone(c) && c.email"> · </span>
        <span v-if="c.email">{{ c.email }}</span>
        <span v-if="!primaryPhone(c) && !c.email">{{ t('clients.noContact') }}</span>
      </div>
      <div class="foot">
        <InmovillaState :record="c" :sent="Boolean(c.remoteId)" :label="c.remoteId ? t('clients.num', { id: c.remoteId }) : ''" />
        <span v-if="c.city" class="muted">· {{ c.city }}</span>
      </div>
    </div>
    <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" /></svg>
  </RouterLink>
</template>

<style scoped>
.client-card { display: flex; align-items: center; gap: 0.85rem; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 0.85rem 1rem; min-height: 72px; }
.avatar { flex: 0 0 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 1rem; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.2rem; }
.name { font-weight: 700; font-size: 1.02rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.foot { display: flex; gap: 0.35rem; font-size: 0.78rem; align-items: center; }
.chevron { width: 22px; height: 22px; color: var(--muted); flex: 0 0 auto; }
</style>
