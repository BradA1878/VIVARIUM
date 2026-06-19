<script setup lang="ts">
/* ============================================================================
   LaunchPrompt — the PTP endgame trigger (right column, under the trade panel).
   Appears once a functional Transport Pod stands and the run is still live: the
   way off-world. Launching ends the run as an "expansion" and the EndScreen
   offers the next world. The HUD only observes the snapshot and issues the
   single launch command (the store archives + founds — doc §0).
   ============================================================================ */
import { computed } from "vue";
import { useColony } from "../stores/colony";
import { buildingFunctional } from "@/engine";
import { WORLD_META } from "../founding";

const { snapshot, controls } = useColony();

/** a working pod is built and the run hasn't ended — the launch is available */
const ready = computed(() => {
  const s = snapshot.value;
  if (!s || s.outcome) return false;
  return s.buildings.some((b) => b.defId === "ptp" && buildingFunctional(b));
});

const worldLabel = computed(() => (snapshot.value ? WORLD_META[snapshot.value.world].label : ""));
</script>

<template>
  <div v-if="ready" class="launch">
    <div class="launch-title">&#9650; TRANSPORT POD READY</div>
    <div class="launch-sub">Leave {{ worldLabel }} and found a colony on a new world.</div>
    <button class="launch-btn" @click="controls.launch()">LAUNCH &#9656;</button>
  </div>
</template>

<style scoped>
.launch {
  pointer-events: auto;
  font-family: var(--mono);
  margin-top: 8px;
  width: 248px;
  max-width: 100%;
  background: var(--panel);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(176, 130, 232, 0.45);
  border-radius: 4px;
  padding: 12px 13px 11px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
}
.launch-title {
  font-size: 11px;
  letter-spacing: 0.2em;
  color: #c7a6f2;
  margin-bottom: 6px;
}
.launch-sub {
  font-size: 9.5px;
  line-height: 1.4;
  color: var(--dim);
  margin-bottom: 10px;
}
.launch-btn {
  width: 100%;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.16em;
  padding: 8px 0;
  border-radius: 3px;
  color: #c7a6f2;
  border: 1px solid rgba(176, 130, 232, 0.5);
  background: rgba(176, 130, 232, 0.1);
  transition: 0.14s;
}
.launch-btn:hover { background: rgba(176, 130, 232, 0.2); color: #ddc8fb; }
</style>
