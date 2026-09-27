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
import { GATE_HINTS } from "@/engine/unlocks";
import { worldProfile } from "@/engine/tuning";
import { useColony } from "@/ui/stores/colony";
import { buildingFacts } from "@/ui/buildingFacts";

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

const consumes = (m: ResMap): string =>
  Object.entries(m).map(([k, v]) => `−${v} ${k}`).join(" ");
/** what the hovered building makes, from its def (solar scaled to this world's sunlight) */
const makes = computed(() =>
  hovered.value ? buildingFacts(hovered.value, worldProfile(snapshot.value?.world).solar).makes : [],
);

const hasEntries = (m: ResMap | undefined): m is ResMap =>
  !!m && Object.keys(m).length > 0;
</script>

<template>
  <div class="palette">
    <div class="pal-head">
      <span class="pal-title">CONSTRUCT</span>
      <!-- Demolish sits in the header, not the grid, so the grid keeps the row
           counts its width tiers are tuned for (hud.css) -->
      <button
        :class="['pal-demo', { sel: demolish }]"
        :disabled="piloting"
        type="button"
        :aria-pressed="demolish"
        @click="toggleDemolish()"
      >
        &#10005; Demolish
      </button>
    </div>
    <div v-if="piloting" class="pal-lock">&#10178; PILOTING — construction locked · F to release</div>
    <div :class="['pal-grid', { locked: piloting }]">
      <button
        v-for="d in defs"
        :key="d.id"
        :class="['pal-btn', { sel: tool === d.id && !demolish, poor: !locked(d) && !affordable(d), lock: locked(d) }]"
        :disabled="piloting || locked(d) || !affordable(d)"
        type="button"
        :aria-pressed="tool === d.id && !demolish"
        :aria-label="`${d.name}, ${costOf(d)} materials${locked(d) ? ', locked' : !affordable(d) ? ', not enough materials' : ''}`"
        @click="pick(d.id)"
        @mouseenter="showTip($event, d)"
        @mouseleave="hideTip"
      >
        <span class="pal-glyph">{{ locked(d) ? "\u{1F512}" : d.glyph }}</span>
        <span class="pal-name">{{ d.name }}</span>
        <span v-if="costOf(d) > 0 && !locked(d)" class="pal-cost">&#9635; {{ costOf(d) }}</span>
      </button>
    </div>

    <!-- in <body>, not the palette: the palette's backdrop-filter (and the
         bottom cluster's transform) would make it the box position:fixed
         measures from, and the viewport coordinates below would land the
         tooltip one palette-offset to the right -->
    <Teleport to="body">
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
        <div v-if="locked(hovered) && GATE_HINTS[hovered.id]" class="tip-lock">
          &#x1F512; LOCKED — unlocks with {{ GATE_HINTS[hovered.id] }}
        </div>
        <div class="tip-stats">
          <span v-for="m in makes" :key="m" class="tip-prod">{{ m }}</span>
          <span v-if="hasEntries(hovered.consumes)" class="tip-cons">{{ consumes(hovered.consumes) }}</span>
          <span v-if="hovered.staffing" class="tip-staff">{{ hovered.staffing }} crew</span>
          <span v-if="hovered.requiresPressure" class="tip-press">sealed</span>
          <span v-if="costOf(hovered) > 0" class="tip-cost">&#9635; {{ costOf(hovered) }} materials</span>
        </div>
      </div>
    </Teleport>
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
