<script setup lang="ts">
/* ============================================================================
   Palette — the build palette (doc §4.x). A row of glyph tiles to pick a
   building to place, plus a Demolish tile. Hovering a tile raises a tooltip
   showing the building's recipe (produces / consumes / caps / staffing /
   pressure). Ported from the React prototype's Palette + showTip/hideTip.
   ============================================================================ */
import { computed, ref } from "vue";
import type { BuildingDef, Resource } from "@shared/types";
import { DEFS, ORDER } from "@/engine";
import { useColony } from "@/ui/stores/colony";

const { snapshot, tool, demolish, pick, toggleDemolish } = useColony();

const defs: BuildingDef[] = ORDER.map((id) => DEFS[id]);

/** materials on hand right now (0 when no snapshot yet) */
const onHand = computed(() => snapshot.value?.materials.amount ?? 0);
const costOf = (d: BuildingDef): number => d.matCost ?? 0;
const affordable = (d: BuildingDef): boolean => onHand.value >= costOf(d);

/** still behind its abundance gate? Only an explicit `false` locks — a missing
 *  key (old save / no snapshot yet) means unlocked, so the palette never
 *  strands a player on stale data */
const locked = (d: BuildingDef): boolean => snapshot.value?.unlocks?.[d.id] === false;

/** UI-local copy of the unlock gates (engine/unlocks.ts GATES), as the tooltip
 *  tells them — keep in step with the real conditions when rebalancing */
const UNLOCK_HINTS: Record<string, string> = {
  windturbine: "sol 4, or survive a dust storm",
  geothermal: "sol 6",
  reactor: "population 8 + 150 materials",
  printer: "population 6",
  roverbay: "sol 3, or stockpile 80 materials",
  roboticsbay: "build a reactor, or population 10 + 200 materials",
  awg: "sol 5, or population 6",
  aquifer: "sol 8 — must sit on an aquifer site",
  reclaimer: "population 6, or build a Hydroponics Unit",
};

/** piloting locks construction — every tile disables while possessing */
const piloting = computed(() => snapshot.value?.possessed != null);

const hovered = ref<BuildingDef | null>(null);
const tipPos = ref<{ left: number; bottom: number }>({ left: 0, bottom: 0 });

function showTip(e: MouseEvent, d: BuildingDef): void {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  // keep the fixed-width tooltip on-screen near the right/left edges
  const tipW = Math.min(206, window.innerWidth - 24);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - tipW - 8));
  tipPos.value = { left, bottom: window.innerHeight - rect.top + 8 };
  hovered.value = d;
}

function hideTip(): void {
  hovered.value = null;
}

// recipe formatting helpers -------------------------------------------------
type ResMap = Partial<Record<Resource, number>>;

const produces = (m: ResMap): string =>
  Object.entries(m).map(([k, v]) => `+${v} ${k}`).join(" ");
const consumes = (m: ResMap): string =>
  Object.entries(m).map(([k, v]) => `−${v} ${k}`).join(" ");
const caps = (m: ResMap): string =>
  Object.entries(m).map(([k, v]) => `+${v} ${k} cap`).join(" ");

const hasEntries = (m: ResMap | undefined): m is ResMap =>
  !!m && Object.keys(m).length > 0;
</script>

<template>
  <div class="palette">
    <div class="pal-title">CONSTRUCT</div>
    <div v-if="piloting" class="pal-lock">&#10178; PILOTING — construction locked · F to release</div>
    <div :class="['pal-grid', { locked: piloting }]">
      <button
        v-for="d in defs"
        :key="d.id"
        :class="['pal-btn', { sel: tool === d.id && !demolish, poor: !locked(d) && !affordable(d), lock: locked(d) }]"
        :disabled="piloting || locked(d) || !affordable(d)"
        @click="pick(d.id)"
        @mouseenter="showTip($event, d)"
        @mouseleave="hideTip"
      >
        <span class="pal-glyph">{{ locked(d) ? "\u{1F512}" : d.glyph }}</span>
        <span class="pal-name">{{ d.name }}</span>
        <span v-if="costOf(d) > 0 && !locked(d)" class="pal-cost">&#9635; {{ costOf(d) }}</span>
      </button>
      <button
        :class="['pal-btn', 'demo', { sel: demolish }]"
        :disabled="piloting"
        @click="toggleDemolish()"
      >
        <span class="pal-glyph">&#10005;</span>
        <span class="pal-name">Demolish</span>
      </button>
    </div>

    <div
      v-if="hovered"
      class="pal-tip"
      :style="{ left: tipPos.left + 'px', bottom: tipPos.bottom + 'px' }"
    >
      <div class="tip-name">
        {{ hovered.name }}
        <span>{{ hovered.foot[0] }}&#215;{{ hovered.foot[1] }}</span>
      </div>
      <div class="tip-desc">{{ hovered.desc }}</div>
      <div v-if="locked(hovered) && UNLOCK_HINTS[hovered.id]" class="tip-lock">
        &#x1F512; LOCKED — unlocks at {{ UNLOCK_HINTS[hovered.id] }}
      </div>
      <div class="tip-stats">
        <span v-if="hovered.solar" class="tip-prod">+{{ hovered.solar }} power (solar)</span>
        <span v-if="hasEntries(hovered.produces)" class="tip-prod">{{ produces(hovered.produces) }}</span>
        <span v-if="hasEntries(hovered.consumes)" class="tip-cons">{{ consumes(hovered.consumes) }}</span>
        <span v-if="hasEntries(hovered.caps)" class="tip-cap">{{ caps(hovered.caps) }}</span>
        <span v-if="hovered.staffing" class="tip-staff">{{ hovered.staffing }} crew</span>
        <span v-if="hovered.requiresPressure" class="tip-press">sealed</span>
        <span v-if="costOf(hovered) > 0" class="tip-cost">&#9635; {{ costOf(hovered) }} materials</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* piloting: the whole palette locks — a hint row, and the grid dims out */
.pal-lock {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--rust);
  text-align: center;
  margin-bottom: 7px;
}
.pal-grid.locked {
  opacity: 0.35;
  filter: grayscale(1);
}
.pal-grid.locked .pal-btn { cursor: not-allowed; }
.pal-cost {
  font-size: 8px;
  letter-spacing: 0.04em;
  color: #c8a25f;
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
}
/* unaffordable: greyed out, not interactive */
.pal-btn.poor {
  opacity: 0.4;
  filter: grayscale(0.7);
  cursor: not-allowed;
}
.pal-btn.poor:hover {
  border-color: var(--hair2);
  background: rgba(255, 255, 255, 0.012);
}
.pal-btn.poor .pal-cost { color: var(--crit); }
/* still behind its abundance gate: dimmer than poor, padlock for a glyph */
.pal-btn.lock {
  opacity: 0.35;
  filter: grayscale(1);
  cursor: not-allowed;
}
.pal-btn.lock:hover {
  border-color: var(--hair2);
  background: rgba(255, 255, 255, 0.012);
}
.tip-lock {
  font-size: 9px;
  letter-spacing: 0.08em;
  color: #c8a25f;
  border: 1px solid rgba(200, 162, 95, 0.3);
  border-radius: 2px;
  padding: 2px 5px;
  margin-top: 5px;
  width: fit-content;
}
.tip-cost {
  color: #c8a25f;
  border: 1px solid rgba(200, 162, 95, 0.3);
  border-radius: 2px;
  padding: 0 4px;
}
</style>
