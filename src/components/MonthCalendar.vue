<script setup>
import { computed, ref } from 'vue'
import { bucketOf, startOfDay } from '../models/followUp'

/** Month grid with a dot per follow-up; v-model:selected = timestamp of the selected day (start of day). */
const props = defineProps({ items: { type: Array, required: true }, selected: { type: Number, default: null } })
const emit = defineEmits(['update:selected'])

const cursor = ref(startOfMonth(props.selected || Date.now()))
function startOfMonth(ts) {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}
const monthLabel = computed(() => new Date(cursor.value).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }))
const weekdays = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

const byDay = computed(() => {
  const map = new Map()
  const now = Date.now()
  for (const f of props.items) {
    const day = startOfDay(f.remindAt)
    const entry = map.get(day) || { total: 0, open: 0, overdue: 0, today: 0 }
    entry.total++
    if (!f.closed) {
      entry.open++
      const b = bucketOf(f, now)
      if (b === 'overdue') entry.overdue++
      if (b === 'today') entry.today++
    }
    map.set(day, entry)
  }
  return map
})

const cells = computed(() => {
  const first = new Date(cursor.value)
  const offset = (first.getDay() + 6) % 7 // Monday first
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset).getTime()
  const today = startOfDay()
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const ts = d.getTime()
    return { ts, day: d.getDate(), inMonth: d.getMonth() === first.getMonth(), isToday: ts === today, info: byDay.value.get(ts) }
  })
})

function move(delta) {
  const d = new Date(cursor.value)
  d.setMonth(d.getMonth() + delta)
  cursor.value = d.getTime()
}
function goToday() {
  cursor.value = startOfMonth(Date.now())
  emit('update:selected', startOfDay())
}
function select(cell) {
  if (!cell.inMonth) cursor.value = startOfMonth(cell.ts)
  emit('update:selected', props.selected === cell.ts ? null : cell.ts)
}
</script>

<template>
  <div class="cal">
    <div class="head">
      <button type="button" class="nav" aria-label="Mes anterior" @click="move(-1)">‹</button>
      <button type="button" class="month" @click="goToday">{{ monthLabel }}</button>
      <button type="button" class="nav" aria-label="Mes siguiente" @click="move(1)">›</button>
    </div>
    <div class="grid weekdays"><span v-for="w in weekdays" :key="w">{{ w }}</span></div>
    <div class="grid days">
      <button
        v-for="c in cells"
        :key="c.ts"
        type="button"
        class="day"
        :class="{ out: !c.inMonth, today: c.isToday, selected: selected === c.ts, has: c.info }"
        :aria-label="new Date(c.ts).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })"
        @click="select(c)"
      >
        <span class="num">{{ c.day }}</span>
        <span v-if="c.info" class="dots">
          <i v-if="c.info.overdue" class="dot overdue"></i>
          <i v-if="c.info.today" class="dot due"></i>
          <i v-if="c.info.open - c.info.overdue - c.info.today > 0" class="dot open"></i>
          <i v-if="c.info.total > c.info.open" class="dot closed"></i>
        </span>
        <span v-if="c.info && c.info.total > 1" class="count">{{ c.info.total }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.cal { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 0.75rem; }
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
.nav { border: 0; background: #eef0fa; color: var(--brand); width: 36px; height: 36px; border-radius: 10px; font-size: 1.3rem; }
.month { border: 0; background: transparent; font-weight: 800; text-transform: capitalize; font-size: 1.05rem; color: var(--text); }
.grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.weekdays span { text-align: center; font-size: 0.72rem; font-weight: 700; color: var(--muted); padding-bottom: 0.25rem; }
.day { position: relative; aspect-ratio: 1; border: 0; border-radius: 10px; background: transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: var(--text); font-weight: 600; padding: 0; }
.day.out { color: #b8bacc; }
.day.has { background: #f4f5fa; }
.day.today .num { color: var(--brand); font-weight: 800; text-decoration: underline; text-underline-offset: 3px; }
.day.selected { background: var(--brand); color: #fff; }
.day.selected .num { color: #fff; }
.dots { display: flex; gap: 3px; height: 6px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); display: inline-block; }
.dot.overdue { background: #c0392b; }
.dot.due { background: var(--accent); }
.dot.closed { background: #b8bacc; }
.selected .dot { background: #fff; }
.count { position: absolute; top: 3px; right: 5px; font-size: 0.6rem; font-weight: 800; color: var(--muted); }
.selected .count { color: #fff; }
</style>
