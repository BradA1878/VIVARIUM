<script setup lang="ts">
/* Crew readout — population vs housing, labor assignment, and the dead count
   (doc §2.6: colonists are a dual resource — they consume and they staff). */
import { computed } from "vue";
import { useColony } from "@/ui/stores/colony";

const { snapshot } = useColony();
const s = computed(() => snapshot.value);
const laborFree = computed(() => (s.value ? s.value.labor - s.value.laborUsed : 0));
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
    <div v-if="s.dead > 0" class="crew-row">
      <span class="crew-k" :style="{ color: '#e8784f' }">LOST</span>
      <span class="crew-v" :style="{ color: '#e8784f' }">{{ s.dead }}</span>
    </div>
  </div>
</template>
