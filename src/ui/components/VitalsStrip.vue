<script setup lang="ts">
/* ============================================================================
   VitalsStrip — the phone astronaut's whole colony readout (tier 2, spec §2).
   Top row: brand mark · SOL n · connection dot. Vitals row: the four survival
   pools with trend arrows, from the SAME snapshot fields the ResourceRail
   reads (pools/flow). Mounted only in the hud--phone mode by App.vue.
   ============================================================================ */
import { computed } from "vue";
import type { Resource } from "@shared/types";
import { useColony } from "../stores/colony";
import { trendOf, vitalText, type Trend } from "./vitals";

const { snapshot, netStatus } = useColony();
const s = computed(() => snapshot.value);

const ORDER: { k: Resource; glyph: string }[] = [
  { k: "power", glyph: "⚡" },
  { k: "oxygen", glyph: "O₂" },
  { k: "water", glyph: "H₂O" },
  { k: "food", glyph: "≡" },
];
const ARROW: Record<Trend, string> = { up: "▲", down: "▼", flat: "·" };
</script>

<template>
  <div v-if="s" class="vitals" aria-label="Colony vitals">
    <div class="vitals-top">
      <span class="vt-mark" aria-hidden="true">◇</span>
      <span class="vt-sol">SOL {{ s.sol }}</span>
      <span class="vt-dot" :class="netStatus" :aria-label="`connection ${netStatus}`" />
    </div>
    <div class="vitals-row">
      <span
        v-for="r in ORDER"
        :key="r.k"
        class="vt-cell"
        :class="'trend-' + trendOf(s.flow[r.k])"
      >
        <span class="vt-glyph">{{ r.glyph }}</span>
        {{ vitalText(s.pools[r.k]) }}
        <span class="vt-arrow" aria-hidden="true">{{ ARROW[trendOf(s.flow[r.k])] }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.vitals {
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 10px 6px;
  background: var(--panel);
  backdrop-filter: blur(9px);
  border-bottom: 1px solid var(--hair);
  font-family: var(--mono);
}
.vitals-top { display: flex; align-items: center; gap: 8px; }
.vt-mark { color: var(--cyan); font-size: 11px; }
.vt-sol { font-size: 10px; letter-spacing: 0.18em; color: var(--ink); }
.vt-dot { width: 7px; height: 7px; margin-left: auto; border-radius: 50%; background: var(--faint); }
.vt-dot.connected { background: #9bd6a0; box-shadow: 0 0 6px rgba(155, 214, 160, 0.7); }
.vt-dot.connecting { background: #e0b45f; }
.vt-dot.failed, .vt-dot.host-left { background: #e07a5f; }
.vitals-row { display: flex; justify-content: space-between; gap: 6px; }
.vt-cell { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--ink); white-space: nowrap; }
.vt-glyph { color: var(--dim); font-size: 10px; margin-right: 1px; }
.vt-arrow { font-size: 9px; }
.vt-cell.trend-up .vt-arrow { color: #9bd6a0; }
.vt-cell.trend-down .vt-arrow { color: #e07a5f; }
.vt-cell.trend-flat .vt-arrow { color: var(--faint); }
</style>
