<script setup>
/**
 * Where the asking price sits against the estimated range: a single horizontal scale
 * with the estimate band (violet), the estimated value, the asking price (orange) and,
 * when known, the value at the peers' median €/m² (blue). Values live in the legend
 * below (text tokens), the marks only carry identity.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { intlLocale } from '../../i18n'

const props = defineProps({
  low: { type: Number, required: true },
  high: { type: Number, required: true },
  value: { type: Number, required: true },
  asking: { type: Number, default: null },
  suggested: { type: Number, default: null },
  medianValue: { type: Number, default: null },
  rent: { type: Boolean, default: false },
})
const { t } = useI18n()
const W = 360
const H = 64
const PAD = 14
const Y = 26
const nf = computed(() => new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 }))
const fmt = (v) => `${nf.value.format(v)} €${props.rent ? t('common.perMonth') : ''}`

const domain = computed(() => {
  const all = [props.low, props.high, props.value, props.asking, props.suggested, props.medianValue].filter((v) => v > 0)
  const min = Math.min(...all)
  const max = Math.max(...all)
  const pad = Math.max((max - min) * 0.12, max * 0.02)
  return [Math.max(0, min - pad), max + pad]
})
const x = (v) => PAD + ((v - domain.value[0]) / (domain.value[1] - domain.value[0] || 1)) * (W - PAD * 2)

const markers = computed(() =>
  [
    { id: 'value', v: props.value, label: t('estimate.legendValue'), cls: 'estimate', shape: 'dot' },
    props.asking ? { id: 'asking', v: props.asking, label: t('estimate.legendAsking'), cls: 'asking', shape: 'diamond' } : null,
    props.medianValue ? { id: 'median', v: props.medianValue, label: t('estimate.legendMedianValue'), cls: 'peer', shape: 'dot' } : null,
    props.suggested && props.suggested !== props.value ? { id: 'suggested', v: props.suggested, label: t('estimate.legendSuggested'), cls: 'estimate', shape: 'ring' } : null,
  ].filter(Boolean),
)
const hover = ref(null)
function show(m, evt) {
  const box = evt.currentTarget.ownerSVGElement.getBoundingClientRect()
  hover.value = { ...m, left: ((x(m.v) / W) * box.width) | 0, top: ((Y / H) * box.height) | 0 }
}
</script>

<template>
  <figure class="chart">
    <figcaption>{{ t('estimate.chartRange') }}</figcaption>
    <div class="plot">
      <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="t('estimate.chartRangeAria', { low: fmt(low), high: fmt(high) })">
        <line :x1="PAD" :x2="W - PAD" :y1="Y" :y2="Y" class="axis" />
        <rect :x="x(low)" :y="Y - 6" :width="Math.max(2, x(high) - x(low))" height="12" rx="6" class="band" />
        <text :x="x(low)" :y="Y + 26" class="edge" text-anchor="middle">{{ fmt(low) }}</text>
        <text :x="x(high)" :y="Y + 26" class="edge" text-anchor="middle">{{ fmt(high) }}</text>
        <line :x1="x(low)" :x2="x(low)" :y1="Y + 8" :y2="Y + 14" class="axis" />
        <line :x1="x(high)" :x2="x(high)" :y1="Y + 8" :y2="Y + 14" class="axis" />
        <g v-for="m in markers" :key="m.id" class="marker" :class="{ hot: hover && hover.id === m.id }" tabindex="0" @pointerenter="show(m, $event)" @focus="show(m, $event)" @pointerleave="hover = null" @blur="hover = null">
          <circle :cx="x(m.v)" :cy="Y" r="14" class="hit" />
          <circle v-if="m.shape === 'dot'" :cx="x(m.v)" :cy="Y" r="6" :class="m.cls" />
          <circle v-else-if="m.shape === 'ring'" :cx="x(m.v)" :cy="Y" r="5" :class="`${m.cls} ring`" />
          <path v-else :d="`M${x(m.v)} ${Y - 8} l8 8 l-8 8 l-8 -8 z`" :class="m.cls" />
        </g>
      </svg>
      <div v-if="hover" class="tip" :style="{ left: hover.left + 'px', top: hover.top + 'px' }" role="status"><strong>{{ fmt(hover.v) }}</strong><span>{{ hover.label }}</span></div>
    </div>
    <ul class="legend">
      <li v-for="m in markers" :key="m.id" :class="{ hot: hover && hover.id === m.id }">
        <span class="key" :class="[m.cls, m.shape]"></span><span class="name">{{ m.label }}</span><strong>{{ fmt(m.v) }}</strong>
      </li>
    </ul>
  </figure>
</template>

<style scoped>
.chart { margin: 0; }
figcaption { font-weight: 600; font-size: 0.9rem; margin-bottom: 0.4rem; }
.plot { position: relative; }
svg { width: 100%; height: auto; display: block; overflow: visible; }
.axis { stroke: var(--border); stroke-width: 1; }
.band { fill: var(--chart-estimate); opacity: 0.18; }
.edge { font-size: 11px; fill: var(--muted); }
.hit { fill: transparent; }
.marker { outline: none; cursor: pointer; }
.marker.hot circle:not(.hit), .marker:focus circle:not(.hit) { r: 8; }
.estimate { fill: var(--chart-estimate); stroke: var(--surface); stroke-width: 2; }
.estimate.ring { fill: var(--surface); stroke: var(--chart-estimate); stroke-width: 3; }
.asking { fill: var(--chart-asking); stroke: var(--surface); stroke-width: 2; }
.peer { fill: var(--chart-peer); stroke: var(--surface); stroke-width: 2; }
.tip { position: absolute; transform: translate(-50%, calc(-100% - 18px)); background: var(--text); color: var(--bg); border-radius: 8px; padding: 0.4rem 0.6rem; font-size: 0.78rem; display: flex; flex-direction: column; pointer-events: none; white-space: nowrap; box-shadow: var(--shadow); z-index: 2; }
.tip strong { font-size: 0.9rem; }
.legend { list-style: none; padding: 0; margin: 0.4rem 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem 1rem; font-size: 0.82rem; }
.legend li { display: flex; align-items: center; gap: 0.4rem; padding: 0.15rem 0.3rem; border-radius: 6px; }
.legend li.hot { background: var(--surface-2); }
.legend .name { color: var(--muted); flex: 1; }
.legend strong { font-variant-numeric: tabular-nums; white-space: nowrap; }
.key { width: 11px; height: 11px; border-radius: 50%; flex: 0 0 auto; }
.key.estimate { background: var(--chart-estimate); }
.key.estimate.ring { background: transparent; border: 3px solid var(--chart-estimate); width: 7px; height: 7px; }
.key.asking { background: var(--chart-asking); border-radius: 2px; transform: rotate(45deg); width: 9px; height: 9px; }
.key.peer { background: var(--chart-peer); }
@media (max-width: 420px) { .legend { grid-template-columns: 1fr; } }
</style>
