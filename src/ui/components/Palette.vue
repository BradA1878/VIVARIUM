<script setup lang="ts">
/* ============================================================================
   Palette — the build palette (doc §4.x). A row of glyph tiles to pick a
   building to place, plus a Demolish tile. Hovering a tile raises a tooltip
   showing the building's recipe (produces / consumes / caps / staffing /
   pressure). Ported from the React prototype's Palette + showTip/hideTip.
   ============================================================================ */
import { ref } from "vue";
import type { BuildingDef, Resource } from "@shared/types";
import { DEFS, ORDER } from "@/engine";
import { useColony } from "@/ui/stores/colony";

const { tool, demolish, pick, toggleDemolish } = useColony();

const defs: BuildingDef[] = ORDER.map((id) => DEFS[id]);

const hovered = ref<BuildingDef | null>(null);
const tipPos = ref<{ left: number; bottom: number }>({ left: 0, bottom: 0 });

function showTip(e: MouseEvent, d: BuildingDef): void {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  tipPos.value = { left: rect.left, bottom: window.innerHeight - rect.top + 8 };
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
    <div class="pal-grid">
      <button
        v-for="d in defs"
        :key="d.id"
        :class="['pal-btn', { sel: tool === d.id && !demolish }]"
        @click="pick(d.id)"
        @mouseenter="showTip($event, d)"
        @mouseleave="hideTip"
      >
        <span class="pal-glyph">{{ d.glyph }}</span>
        <span class="pal-name">{{ d.name }}</span>
      </button>
      <button
        :class="['pal-btn', 'demo', { sel: demolish }]"
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
      <div class="tip-stats">
        <span v-if="hovered.solar" class="tip-prod">+{{ hovered.solar }} power (solar)</span>
        <span v-if="hasEntries(hovered.produces)" class="tip-prod">{{ produces(hovered.produces) }}</span>
        <span v-if="hasEntries(hovered.consumes)" class="tip-cons">{{ consumes(hovered.consumes) }}</span>
        <span v-if="hasEntries(hovered.caps)" class="tip-cap">{{ caps(hovered.caps) }}</span>
        <span v-if="hovered.staffing" class="tip-staff">{{ hovered.staffing }} crew</span>
        <span v-if="hovered.requiresPressure" class="tip-press">sealed</span>
      </div>
    </div>
  </div>
</template>
