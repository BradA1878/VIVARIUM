<script setup lang="ts">
/* Crew readout — population vs housing, labor assignment, colony morale, and
   the dead count (doc §2.6: colonists are a dual resource — they consume and
   they staff; morale scales what their buildings produce). */
import { computed } from "vue";
import { useColony } from "@/ui/stores/colony";
import { MORALE_LOW_T, MORALE_OK_T } from "@/engine/tuning";

const { snapshot } = useColony();
const s = computed(() => snapshot.value);
const laborFree = computed(() => (s.value ? s.value.labor - s.value.laborUsed : 0));

const moralePct = computed(() => Math.round((s.value?.morale ?? 0) * 100));
/* cyan while the colony holds, rust as it slips, crit below the low latch —
   the same thresholds the engine uses for morale_low / morale_recovered */
const moraleCol = computed(() => {
  const m = s.value?.morale ?? 1;
  if (m < MORALE_LOW_T) return "var(--crit)";
  if (m < MORALE_OK_T) return "var(--rust)";
  return "var(--cyan)";
});
</script>

<template>
  <div v-if="s" class="crew">
    <div class="crew-row">
      <span class="crew-k">CREW</span>
      <span class="crew-v">{{ s.population }}<span class="crew-sub">/{{ s.housing }} berths</span></span>
    </div>
    <div class="crew-row">
      <span class="crew-k">LABOR</span>
      <span class="crew-v" :style="{ color: laborFree < 0 ? '#e8784f' : '#d6e2e6' }">
        {{ s.laborUsed }}<span class="crew-sub">/{{ s.labor }} assigned</span>
      </span>
    </div>
    <div class="crew-row">
      <span class="crew-k">MORALE</span>
      <span class="crew-v" :style="{ color: moraleCol }">{{ moralePct }}<span class="crew-sub">%</span></span>
    </div>
    <div v-if="s.dead > 0" class="crew-row">
      <span class="crew-k" :style="{ color: '#e8784f' }">LOST</span>
      <span class="crew-v" :style="{ color: '#e8784f' }">{{ s.dead }}</span>
    </div>
  </div>
</template>
