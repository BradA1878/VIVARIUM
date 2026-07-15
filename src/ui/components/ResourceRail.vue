<script setup lang="ts">
/* ============================================================================
   ResourceRail — the readout rail (doc §4.3). Maps the four resources (power →
   oxygen → water → food) onto ResCell, pulling pools/flow/timers from the live
   snapshot. Power has no lethal timer; oxygen/water/food do.
   ============================================================================ */
import { computed } from "vue";
import type { Resource } from "@shared/types";
import { useColony } from "@/ui/stores/colony";
import { RES } from "@/ui/resources";
import { fmt } from "@/ui/format";
import { Tuning } from "@/engine";
import ResCell from "./ResCell.vue";

const { snapshot } = useColony();
const s = computed(() => snapshot.value);

const timerFor = (k: Resource): number | null =>
  k === "power" ? null : s.value!.timers[k] ?? null;

// materials — the build currency. No flow/ETA, so it gets a slimmer cell.
const mat = computed(() => s.value!.materials);
const matPct = computed(() =>
  Math.max(0, Math.min(1, mat.value.amount / mat.value.capacity)),
);

// the Fabricator lineage vs its hard cap — rendered only once one exists
const fabs = computed(() =>
  s.value!.buildings.reduce((n, b) => n + (b.defId === "fabricator" ? 1 : 0), 0),
);
const fabPct = computed(() =>
  Math.max(0, Math.min(1, fabs.value / Tuning.FAB_MAX_LINEAGE)),
);
</script>

<template>
  <div v-if="s" class="rail-res">
    <ResCell
      v-for="meta in RES"
      :key="meta.k"
      :meta="meta"
      :pool="s.pools[meta.k]"
      :net="s.flow[meta.k]"
      :timer="timerFor(meta.k)"
    />
    <div class="res res-mat">
      <div class="res-head">
        <span class="res-label" :style="{ color: '#c8a25f' }">
          <span class="res-glyph">&#9635;</span>MATERIALS
        </span>
      </div>
      <div class="res-nums">
        <span class="res-amt" :style="{ color: '#d6c79e' }">{{ fmt(mat.amount) }}</span>
        <span class="res-cap">/ {{ fmt(mat.capacity) }} mat</span>
      </div>
      <div class="res-bar">
        <div
          class="res-fill"
          :style="{
            width: matPct * 100 + '%',
            background: '#c8a25f',
            boxShadow: '0 0 8px #c8a25f66',
          }"
        />
      </div>
    </div>
    <div v-if="fabs > 0" class="res res-fab">
      <div class="res-head">
        <span class="res-label" :style="{ color: '#9db07f' }">
          <span class="res-glyph">&#9707;</span>FABRICATORS
        </span>
      </div>
      <div class="res-nums">
        <span class="res-amt" :style="{ color: '#c2cfa6' }">{{ fabs }}</span>
        <span class="res-cap">/ {{ Tuning.FAB_MAX_LINEAGE }} cap</span>
      </div>
      <div class="res-bar">
        <div
          class="res-fill"
          :style="{
            width: fabPct * 100 + '%',
            background: '#9db07f',
            boxShadow: '0 0 8px #9db07f66',
          }"
        />
      </div>
    </div>
  </div>
</template>
