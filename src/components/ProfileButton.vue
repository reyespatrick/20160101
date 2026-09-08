<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'

const { t } = useI18n()
const auth = useAuthStore()
const initials = computed(() => {
  const src = auth.user?.name || auth.user?.email || '?'
  const parts = src.split(/[\s@.]+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase()
})
</script>

<template>
  <RouterLink :to="{ name: 'profile' }" class="profile-btn" :title="t('profile.title')" :aria-label="t('profile.title')">
    <span class="avatar" :class="{ warn: auth.isAdmin && !auth.hasKeys }">{{ initials }}</span>
    <span class="name">{{ auth.user?.name || auth.user?.email }}</span>
  </RouterLink>
</template>

<style scoped>
.profile-btn { display: flex; align-items: center; gap: 0.5rem; color: var(--text); }
.avatar { position: relative; width: 36px; height: 36px; border-radius: 50%; background: var(--brand); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 0.85rem; }
.avatar.warn::after { content: ''; position: absolute; top: -2px; right: -2px; width: 11px; height: 11px; border-radius: 50%; background: var(--accent); border: 2px solid var(--surface); }
.name { font-size: 0.9rem; font-weight: 600; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 480px) { .name { display: none; } }
</style>
