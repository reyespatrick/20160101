<script setup>
import ProfileButton from './ProfileButton.vue'
</script>

<template>
  <header class="header">
    <RouterLink to="/" class="brand">
      <img src="/icons/favicon-64.png" alt="" width="32" height="32" />
      <span>immoba</span>
    </RouterLink>
    <ProfileButton />
  </header>
</template>

<style scoped>
.header { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 1rem; padding-top: calc(0.6rem + env(safe-area-inset-top)); background: var(--surface); border-bottom: 1px solid var(--border); }
.brand { display: flex; align-items: center; gap: 0.5rem; font-weight: 800; color: var(--brand); letter-spacing: 0.02em; }
.brand img { border-radius: 8px; }
</style>
