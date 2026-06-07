<script setup lang="ts">
/* Campaign objective (doc §2.5) — the launch-window deadline and the road to
   self-sufficiency. Reach a real settlement that needs no resupply before Earth's
   window closes. */
import { computed } from "vue";
import { useColony } from "@/ui/stores/colony";
import { fmt } from "@/ui/format";

const { snapshot } = useColony();
const s = computed(() => snapshot.value);

const windowPct = computed(() => {
  if (!s.value) return 0;
  // sol 1 → deadline maps 0 → 1
  const span = s.value.deadlineSol - 1;
  return Math.max(0, Math.min(1, (s.value.sol - 1) / Math.max(1, span)));
});
const solsLeft = computed(() => (s.value ? Math.max(0, s.value.deadlineSol - s.value.sol) : 0));
const sufficiencyPct = computed(() =>
  s.value ? Math.max(0, Math.min(1, s.value.selfSufficientFor / s.value.selfSufficiencyGoal)) : 0,
);
const popMet = computed(() => (s.value ? s.value.population >= s.value.targetPop : false));
</script>

<template>
  <div v-if="s" class="objective">
    <div class="obj-title">OBJECTIVE · SELF-SUFFICIENCY</div>

    <div class="obj-row">
      <span class="obj-k">LAUNCH WINDOW</span>
      <span class="obj-v" :class="{ warn: solsLeft <= 3 }">{{ solsLeft }} sols left</span>
    </div>
    <div class="obj-bar">
      <div class="obj-fill window" :style="{ width: windowPct * 100 + '%' }" />
    </div>

    <div class="obj-row">
      <span class="obj-k">CREW</span>
      <span class="obj-v" :class="{ ok: popMet }">{{ s.population }}/{{ s.targetPop }}</span>
    </div>
    <div class="obj-row">
      <span class="obj-k">SUSTAINED</span>
      <span class="obj-v" :class="{ ok: sufficiencyPct >= 1 }">
        {{ fmt(s.selfSufficientFor) }}/{{ fmt(s.selfSufficiencyGoal) }}s
      </span>
    </div>
    <div class="obj-bar">
      <div class="obj-fill suff" :style="{ width: sufficiencyPct * 100 + '%' }" />
    </div>
  </div>
</template>
