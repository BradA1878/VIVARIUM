<script setup lang="ts">
/* ============================================================================
   ResCell — a single resource readout (doc §4.3). Presentational: it takes a
   meta descriptor, the live pool, net flow, and an optional lethal timer, and
   renders the labelled bar + ETA footer. Ported from the prototype's ResCell.
   ============================================================================ */
import { computed } from "vue";
import type { ResMeta } from "@/ui/resources";
import { fmt, eta } from "@/ui/format";

const props = defineProps<{
  meta: ResMeta;
  pool: { amount: number; capacity: number };
  net: number;
  timer: number | null;
}>();

const pct = computed(() =>
  Math.max(0, Math.min(1, props.pool.amount / props.pool.capacity)),
);
const crit = computed(() => props.timer != null);
const low = computed(() => pct.value < 0.12);
const draining = computed(() => props.net < -0.05);
const e = computed(() => eta(props.pool.amount, props.net));

const cellClass = computed(() =>
  crit.value ? "res res-crit" : low.value ? "res res-low" : "res",
);
const flowCol = computed(() =>
  props.net > 0.05 ? props.meta.col : props.net < -0.05 ? "#e8784f" : "#5b6970",
);
const fillCol = computed(() => (crit.value ? "#e8784f" : props.meta.col));
const ticks = [0.25, 0.5, 0.75];
</script>

<template>
  <div :class="cellClass">
    <div class="res-head">
      <span class="res-label" :style="{ color: meta.col }">
        <span class="res-glyph">{{ meta.glyph }}</span>{{ meta.label }}
      </span>
      <span class="res-flow" :style="{ color: flowCol }">
        {{ net > 0.05 ? "+" : "" }}{{ fmt(net, 1) }}<span class="res-per">/s</span>
      </span>
    </div>
    <div class="res-nums">
      <span class="res-amt" :style="{ color: crit ? '#e8784f' : '#d6e2e6' }">{{ fmt(pool.amount) }}</span>
      <span class="res-cap">/ {{ fmt(pool.capacity) }} {{ meta.unit }}</span>
    </div>
    <div class="res-bar">
      <div
        class="res-fill"
        :style="{
          width: pct * 100 + '%',
          background: fillCol,
          boxShadow: `0 0 8px ${fillCol}66`,
        }"
      />
      <div class="res-ticks">
        <span v-for="t in ticks" :key="t" :style="{ left: t * 100 + '%' }" />
      </div>
    </div>
    <div class="res-foot">
      <span v-if="crit" class="res-eta crit">LETHAL IN {{ fmt(timer) }}s</span>
      <span v-else-if="draining && e" class="res-eta">empty in {{ e }}</span>
      <span v-else-if="net > 0.05" class="res-eta pos">surplus</span>
      <span v-else class="res-eta dim">holding</span>
    </div>
  </div>
</template>
