<script setup lang="ts">
/* Crew readout — population vs housing, labor assignment, colony morale, and
   the dead count (doc §2.6: colonists are a dual resource — they consume and
   they staff; morale scales what their buildings produce). */
import { computed } from "vue";
import { useColony } from "@/ui/stores/colony";
import { MORALE_LOW_T, MORALE_OK_T } from "@/engine/tuning";
import { crewInjurySummary } from "./crew";

const { snapshot } = useColony();
const s = computed(() => snapshot.value);
const laborFree = computed(() => (s.value ? s.value.labor - s.value.laborUsed : 0));

const moralePct = computed(() => Math.round((s.value?.morale ?? 0) * 100));
const injury = computed(() => crewInjurySummary(s.value?.colonists ?? []));
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
      <span class="crew-k" :style="{ color: '#e8784f' }">DEAD</span>
      <span class="crew-v" :style="{ color: '#e8784f' }">{{ s.dead }}</span>
    </div>
    <div
      v-if="injury"
      class="crew-injury"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span class="crew-injury-mark" aria-hidden="true">!</span>
      <span class="crew-injury-copy">
        <strong>{{ injury.label }}</strong>
        <span>{{ injury.status }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.crew {
  flex-wrap: wrap;
  row-gap: 8px;
}

.crew-injury {
  flex: 1 0 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding-top: 8px;
  border-top: 1px solid rgba(232, 120, 79, 0.24);
}

.crew-injury-mark {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  color: #f3c0ad;
  background: rgba(232, 120, 79, 0.12);
  border: 1px solid rgba(232, 120, 79, 0.58);
  border-radius: 50%;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}

.crew-injury-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
  overflow-wrap: anywhere;
}

.crew-injury-copy strong {
  color: #f09a78;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.16em;
}

.crew-injury-copy span {
  color: var(--ink);
  font-size: 9px;
  letter-spacing: 0.035em;
  line-height: 1.4;
}
</style>
