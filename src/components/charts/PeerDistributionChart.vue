<script setup>
/**
 * Dot histogram of the comparables' price per m². Each dot is one listing (hover for
 * details); the shaded band is the interquartile range, the hairline the median, the
 * orange marker this property's asking €/m², the violet band the estimate range.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { intlLocale } from '../../i18n'

const props = defineProps({
  peers: { type: Array, default: () => [] },
  stats: { type: Object, default: () => ({}) },
  propertyPpm2: { type: Number, default: null },
  estimateLow: { type: Number, default: null },
  estimateHigh: { type: Number, default: null },
  rent: { type: Boolean, default: false },
})
const { t } = useI18n()

const W = 360
const H = 170
const PAD = { l: 12, r: 12, t: 30, b: 30 }
const DOT = 4.5
const GAP = 2
const nf = computed(() => new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 }))
const fmt = (v) => `${nf.value.format(v)} €/m²`
const fmtEur = (v) => `${nf.value.format(v)} €${props.rent ? t('common.perMonth') : ''}`

const values = computed(() => props.peers.filter((p) => p.ppm2 > 0))
const domain = computed(() => {
  const all = [...values.value.map((p) => p.ppm2), props.propertyPpm2, props.estimateLow, props.estimateHigh].filter((v) => v > 0)
  if (!all.length) return [0, 1]
  const min = Math.min(...all)
  const max = Math.max(...all)
  const pad = Math.max((max - min) * 0.08, 1)
  return [Math.max(0, min - pad), max + pad]
})
const x = (v) => PAD.l + ((v - domain.value[0]) / (domain.value[1] - domain.value[0] || 1)) * (W - PAD.l - PAD.r)
const baseline = H - PAD.b

/** Stacked dots: bins wide enough for one dot, dots stacked upwards. */
const dots = computed(() => {
  const binW = DOT * 2 + GAP
  const bins = new Map()
  const out = []
  for (const p of [...values.value].sort((a, b) => a.ppm2 - b.ppm2)) {
    const bin = Math.floor((x(p.ppm2) - PAD.l) / binW)
    const n = bins.get(bin) || 0
    bins.set(bin, n + 1)
    out.push({ ...p, cx: PAD.l + bin * binW + DOT, cy: baseline - DOT - n * (DOT * 2 + GAP) })
  }
  return out
})
const overflow = computed(() => dots.value.some((d) => d.cy < PAD.t + 10))
const ticks = computed(() => {
  const [a, b] = domain.value
  const span = b - a || 1
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((s) => span / s <= 6) || 5000
  const out = []
  for (let v = Math.ceil(a / step) * step; v <= b; v += step) out.push(v)
  return out
})

const hover = ref(null)
const table = ref(false)
function show(d, evt) {
  const box = evt.currentTarget.ownerSVGElement.getBoundingClientRect()
  hover.value = { ...d, left: ((d.cx / W) * box.width) | 0, top: ((d.cy / H) * box.height) | 0 }
}
</script>

<template>
  <figure class="chart">
    <div class="chart-head">
      <figcaption>{{ t('estimate.chartPeers', { n: values.length }) }}</figcaption>
      <button type="button" class="link" @click="table = !table">{{ table ? t('estimate.showChart') : t('estimate.showTable') }}</button>
    </div>

    <div v-if="!table" class="plot">
      <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="t('estimate.chartPeersAria')">
        <!-- IQR wash + median -->
        <rect v-if="stats.q1 && stats.q3" :x="x(stats.q1)" :y="PAD.t" :width="Math.max(1, x(stats.q3) - x(stats.q1))" :height="baseline - PAD.t" class="iqr" />
        <line v-if="stats.median" :x1="x(stats.median)" :x2="x(stats.median)" :y1="PAD.t - 4" :y2="baseline" class="median" />
        <text v-if="stats.median" :x="x(stats.median)" :y="PAD.t - 8" class="lbl" text-anchor="middle">{{ t('estimate.median') }} {{ fmt(stats.median) }}</text>
        <!-- estimate band -->
        <rect v-if="estimateLow && estimateHigh" :x="x(estimateLow)" :y="baseline - 4" :width="Math.max(2, x(estimateHigh) - x(estimateLow))" height="4" class="estimate" rx="2" />
        <!-- axis -->
        <line :x1="PAD.l" :x2="W - PAD.r" :y1="baseline" :y2="baseline" class="axis" />
        <g v-for="v in ticks" :key="v">
          <line :x1="x(v)" :x2="x(v)" :y1="baseline" :y2="baseline + 4" class="axis" />
          <text :x="x(v)" :y="baseline + 16" class="tick" text-anchor="middle">{{ nf.format(v) }}</text>
        </g>
        <text :x="W - PAD.r" :y="H - 4" class="tick" text-anchor="end">€/m²</text>
        <!-- peers -->
        <g v-for="d in dots" :key="d.codOfer || d.ref" class="dot" :class="{ hot: hover && hover.codOfer === d.codOfer }" tabindex="0" @pointerenter="show(d, $event)" @focus="show(d, $event)" @pointerleave="hover = null" @blur="hover = null">
          <circle :cx="d.cx" :cy="d.cy" :r="12" class="hit" />
          <circle :cx="d.cx" :cy="d.cy" :r="DOT" class="peer" />
        </g>
        <!-- this property -->
        <g v-if="propertyPpm2">
          <line :x1="x(propertyPpm2)" :x2="x(propertyPpm2)" :y1="PAD.t + 6" :y2="baseline" class="mine-line" />
          <path :d="`M${x(propertyPpm2)} ${PAD.t - 2} l6 7 l-6 7 l-6 -7 z`" class="mine" />
        </g>
      </svg>
      <div v-if="hover" class="tip" :style="{ left: hover.left + 'px', top: hover.top + 'px' }" role="status">
        <strong>{{ fmt(hover.ppm2) }}</strong>
        <span>{{ hover.ref }} · {{ fmtEur(hover.price) }} · {{ hover.m2 }} m² · {{ [hover.zone, hover.city].filter(Boolean).join(', ') }}</span>
      </div>
      <p v-if="overflow" class="muted small">{{ t('estimate.stacked') }}</p>
    </div>

    <div v-else class="table-wrap">
      <table>
        <thead><tr><th>{{ t('common.ref') }}</th><th>{{ t('estimate.price') }}</th><th>m²</th><th>€/m²</th><th>{{ t('estimate.location') }}</th></tr></thead>
        <tbody>
          <tr v-for="p in [...values].sort((a, b) => a.ppm2 - b.ppm2)" :key="p.codOfer || p.ref">
            <td>{{ p.ref }}</td><td>{{ fmtEur(p.price) }}</td><td>{{ p.m2 }}</td><td>{{ nf.format(p.ppm2) }}</td><td>{{ [p.zone, p.city].filter(Boolean).join(', ') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <ul class="legend">
      <li><span class="key peer-key"></span>{{ t('estimate.legendPeer') }}</li>
      <li><span class="key mine-key"></span>{{ t('estimate.legendMine') }}</li>
      <li><span class="key iqr-key"></span>{{ t('estimate.legendIqr') }}</li>
      <li><span class="key est-key"></span>{{ t('estimate.legendEstimate') }}</li>
    </ul>
  </figure>
</template>

<style scoped>
.chart { margin: 0; }
.chart-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin-bottom: 0.4rem; }
figcaption { font-weight: 600; font-size: 0.9rem; }
.link { border: 0; background: none; color: var(--brand); font-weight: 600; padding: 0; font-size: 0.85rem; text-decoration: underline; }
.plot { position: relative; }
svg { width: 100%; height: auto; display: block; overflow: visible; }
.iqr { fill: var(--chart-peer); opacity: 0.1; }
.median { stroke: var(--chart-peer); stroke-width: 1.5; }
.estimate { fill: var(--chart-estimate); }
.axis { stroke: var(--border); stroke-width: 1; }
.tick { font-size: 10px; fill: var(--muted); }
.lbl { font-size: 10px; fill: var(--muted); font-weight: 600; }
.hit { fill: transparent; }
.peer { fill: var(--chart-peer); stroke: var(--surface); stroke-width: 2; transition: r 0.1s; }
.dot { outline: none; cursor: pointer; }
.dot.hot .peer, .dot:focus .peer { r: 6.5; }
.mine-line { stroke: var(--chart-asking); stroke-width: 2; stroke-linecap: round; }
.mine { fill: var(--chart-asking); stroke: var(--surface); stroke-width: 2; }
.tip { position: absolute; transform: translate(-50%, calc(-100% - 14px)); background: var(--text); color: var(--bg); border-radius: 8px; padding: 0.4rem 0.6rem; font-size: 0.78rem; display: flex; flex-direction: column; gap: 0.1rem; pointer-events: none; white-space: nowrap; max-width: 90vw; box-shadow: var(--shadow); z-index: 2; }
.tip strong { font-size: 0.9rem; }
.legend { list-style: none; padding: 0; margin: 0.5rem 0 0; display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; font-size: 0.78rem; color: var(--muted); }
.legend li { display: flex; align-items: center; gap: 0.35rem; }
.key { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
.peer-key { background: var(--chart-peer); }
.mine-key { background: var(--chart-asking); border-radius: 2px; transform: rotate(45deg); width: 10px; height: 10px; }
.iqr-key { background: var(--chart-peer); opacity: 0.2; border-radius: 2px; }
.est-key { background: var(--chart-estimate); height: 4px; width: 16px; border-radius: 2px; }
.small { font-size: 0.78rem; margin: 0.2rem 0 0; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.82rem; }
th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); white-space: nowrap; }
th { color: var(--muted); font-weight: 600; }
</style>
