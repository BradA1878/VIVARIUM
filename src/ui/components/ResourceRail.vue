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
import ResCell from "./ResCell.vue";

const { snapshot } = useColony();
const s = computed(() => snapshot.value);

const timerFor = (k: Resource): number | null =>
  k === "power" ? null : s.value!.timers[k] ?? null;
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
  </div>
</template>
