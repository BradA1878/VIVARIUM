<script setup lang="ts">
/* The campaign's last frame (doc §2.5). On victory the colony has reached
   self-sufficiency before the launch window closed; on defeat the window shut on
   an unfinished colony, or the last colonist died. The Chronicler has already
   spoken; this is the record on the screen. */
import { computed } from "vue";
import { useColony } from "@/ui/stores/colony";

const { snapshot, controls } = useColony();
const s = computed(() => snapshot.value);
const won = computed(() => s.value?.outcome === "victory");

const headline = computed(() => (won.value ? "SELF-SUFFICIENT" : "THE COLONY IS LOST"));
const subline = computed(() => {
  if (!s.value) return "";
  if (won.value) return "It needs Earth no longer. The watch holds.";
  return s.value.outcomeReason === "window"
    ? "The launch window closed before the colony could stand on its own."
    : "The last of them stopped breathing. Only the record remains.";
});
</script>

<template>
  <div v-if="s && s.outcome" class="endscreen" :class="won ? 'win' : 'lose'">
    <div class="end-inner">
      <div class="end-mark">{{ headline }}</div>
      <div class="end-sub">{{ subline }}</div>
      <div class="end-stats">
        <span><b>{{ s.sol }}</b> sols</span>
        <span class="sep">·</span>
        <span><b>{{ s.population }}</b> survived</span>
        <span class="sep">·</span>
        <span :class="{ lost: s.dead > 0 }"><b>{{ s.dead }}</b> lost</span>
      </div>
      <button class="end-btn" @click="controls.reset()">BEGIN AGAIN</button>
    </div>
  </div>
</template>
