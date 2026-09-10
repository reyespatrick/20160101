<script setup>
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref } from 'vue'
import FollowUpCard from '../components/FollowUpCard.vue'
import MonthCalendar from '../components/MonthCalendar.vue'
import { BUCKETS, startOfDay } from '../models/followUp'
import { useFollowUpsStore } from '../stores/followUps'
import { useAuthStore } from '../stores/auth'
import { intlLocale } from '../i18n'
const { t } = useI18n()

const store = useFollowUpsStore()
const auth = useAuthStore()
const mode = ref(localStorage.getItem('immoba.agenda.mode') === 'calendar' ? 'calendar' : 'list')
const selectedDay = ref(startOfDay())

function setMode(m) {
  mode.value = m
  try {
    localStorage.setItem('immoba.agenda.mode', m)
  } catch {
    /* ignore */
  }
}

onMounted(async () => {
  await store.ensureLoaded()
  store.sync()
})

/** The empty screen carries its own call to action; a second one in the bar is noise. */
const emptyCta = computed(() => !store.loading && mode.value === 'list' && !store.active.length)
const dayItems = computed(() => {
  if (!selectedDay.value) return []
  const end = selectedDay.value + 86_400_000
  return store.active.filter((f) => f.remindAt >= selectedDay.value && f.remindAt < end && (store.showClosed || !f.closed)).sort((a, b) => a.remindAt - b.remindAt)
})
const dayLabel = computed(() => (selectedDay.value ? new Date(selectedDay.value).toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' }) : ''))

function syncLabel() {
  if (store.syncing || store.pulling) return t('agenda.syncing')
  if (store.rateLimitedUntil > Date.now()) return t('common.rateLimited')
  if (store.pendingCount) return t('common.pending', store.pendingCount)
  return t('common.allInInmovilla')
}
</script>

<template>
  <section class="container agenda">
    <div class="toolbar">
      <div class="segments" role="tablist">
        <button type="button" role="tab" :aria-selected="mode === 'list'" :class="{ active: mode === 'list' }" @click="setMode('list')">{{ t('agenda.list') }}</button>
        <button type="button" role="tab" :aria-selected="mode === 'calendar'" :class="{ active: mode === 'calendar' }" @click="setMode('calendar')">{{ t('agenda.calendar') }}</button>
      </div>
      <label class="toggle"><input v-model="store.showClosed" type="checkbox" /> {{ t('agenda.showClosed') }}</label>
      <RouterLink v-if="auth.canWrite && !emptyCta" :to="{ name: 'followup-new' }" class="btn new-btn">+ {{ t('common.new') }}</RouterLink>
    </div>

    <input v-if="mode === 'list'" v-model="store.query" type="search" class="search" :placeholder="t('agenda.searchPh')" :aria-label="t('common.search')" />

    <p class="sync muted">
      <span class="sync-dot" :class="{ pending: store.pendingCount, busy: store.syncing || store.pulling }"></span>
      {{ syncLabel() }}
      <button v-if="!store.syncing && !store.pulling" type="button" class="link" @click="store.sync(); store.pull({ force: true })">{{ t('common.update') }}</button>
    </p>
    <p v-if="store.needsLogin" class="alert">{{ t('common.keysRejected') }}</p>
    <p v-else-if="store.syncError" class="alert">{{ store.syncError }}</p>

    <div v-if="store.loading" class="spinner"></div>

    <template v-else-if="mode === 'calendar'">
      <MonthCalendar :items="store.showClosed ? store.active : store.active.filter((f) => !f.closed)" :selected="selectedDay" @update:selected="selectedDay = $event" />
      <h2 v-if="selectedDay" class="day-title">{{ dayLabel }}</h2>
      <div v-if="selectedDay && !dayItems.length" class="empty small">
        <p class="muted">{{ t('agenda.nothingToday') }}</p>
        <RouterLink v-if="auth.canWrite" :to="{ name: 'followup-new', query: { at: selectedDay } }" class="btn btn-ghost">{{ t('agenda.addFollowUp') }}</RouterLink>
      </div>
      <div v-else class="list"><FollowUpCard v-for="f in dayItems" :key="f.id" :follow-up="f" /></div>
    </template>

    <template v-else>
      <div v-if="!store.active.length" class="empty">
        <div class="empty-icon">📅</div>
        <h2>{{ t('agenda.empty') }}</h2>
        <p class="muted">{{ t('agenda.emptyBody') }}</p>
        <RouterLink v-if="auth.canWrite" :to="{ name: 'followup-new' }" class="btn">{{ t('agenda.new') }}</RouterLink>
      </div>
      <div v-else-if="!store.filtered.length" class="empty"><h2>{{ t('common.noResults') }}</h2></div>
      <template v-else>
        <section v-for="b in BUCKETS" :key="b.value" class="group">
          <template v-if="store.grouped[b.value].length">
            <h2 :style="{ color: b.color }">{{ t(b.labelKey) }} <span class="n">{{ store.grouped[b.value].length }}</span></h2>
            <div class="list"><FollowUpCard v-for="f in store.grouped[b.value]" :key="f.id" :follow-up="f" /></div>
          </template>
        </section>
      </template>
    </template>

    <RouterLink v-if="auth.canWrite && !emptyCta" :to="{ name: 'followup-new', query: mode === 'calendar' && selectedDay ? { at: selectedDay } : {} }" class="fab" :aria-label="t('agenda.new')">+</RouterLink>
  </section>
</template>

<style scoped>
.agenda { padding-bottom: 5.5rem; }
.toolbar { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.6rem; }
.segments { display: inline-flex; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 3px; }
.segments button { border: 0; background: transparent; border-radius: 8px; padding: 0.5rem 0.9rem; font-weight: 600; color: var(--muted); }
.segments button.active { background: var(--brand); color: #fff; }
.toggle { display: flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; color: var(--muted); margin-left: auto; }
.toggle input { accent-color: var(--brand); width: 18px; height: 18px; }
.new-btn { white-space: nowrap; }
.search { width: 100%; border: 1px solid var(--border); border-radius: 12px; padding: 0.8rem 0.9rem; background: var(--surface); font-size: 1rem; margin-bottom: 0.4rem; }
.sync { display: flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; margin: 0.25rem 0 0.75rem; }
.sync-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.sync-dot.pending { background: var(--accent); }
.sync-dot.busy { background: var(--brand); animation: pulse 1s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.link { border: 0; background: none; color: var(--brand); font-weight: 600; padding: 0; text-decoration: underline; font-size: inherit; }
.group h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 1rem 0 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
.n { background: var(--border); color: var(--text); border-radius: 999px; padding: 0 0.5rem; font-size: 0.75rem; }
.day-title { font-size: 1rem; margin: 1rem 0 0.5rem; text-transform: capitalize; }
.list { display: flex; flex-direction: column; gap: 0.6rem; }
.empty { text-align: center; padding: 3rem 1rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
.empty.small { padding: 1.5rem 1rem; }
.empty h2 { margin: 0; }
.empty p { margin: 0 0 0.75rem; }
.empty-icon { font-size: 3rem; }
.fab { position: fixed; right: 1.25rem; bottom: calc(var(--nav-height) + 1rem + env(safe-area-inset-bottom)); width: 58px; height: 58px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 2rem; line-height: 1; display: grid; place-items: center; box-shadow: 0 6px 18px rgba(243, 146, 0, 0.45); }
@media (min-width: 720px) { .fab { display: none; } }
@media (max-width: 719px) { .new-btn { display: none; } }
</style>
