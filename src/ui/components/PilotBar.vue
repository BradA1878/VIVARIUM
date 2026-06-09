<script setup lang="ts">
/* ============================================================================
   PilotBar — the compact piloting bar (bottom-center, above the Inspector).
   Shown only while the player is possessing a colonist. Observes the possessed
   colonist's carry state + action and surfaces a one-line context hint. The F
   key (release) is bound in App.vue.
   ============================================================================ */
import { computed } from "vue";
import { useColony } from "../stores/colony";
import { fmt } from "../format";

const { snapshot } = useColony();

const pilot = computed(() => {
  const s = snapshot.value;
  if (!s || s.possessed == null) return null;
  return s.colonists.find((c) => c.possessed) ?? null;
});

const CARRY_COL: Record<"ice" | "ore" | "cache", string> = {
  ice: "#7fd4e8",
  ore: "#e0913a",
  cache: "#6fcf7f",
};

const carryCol = computed(() =>
  pilot.value?.carryKind ? CARRY_COL[pilot.value.carryKind] : undefined,
);

const hint = computed(() => {
  const p = pilot.value;
  if (!p) return "";
  if (p.state === "mining") return "mining…";
  if (p.state === "hauling") return "unloading…";
  return "Arrow keys / WASD to move · walk onto a deposit to mine · return to base to unload";
});
</script>

<template>
  <div v-if="pilot" class="pilot">
    <span class="pilot-tag">&#9654; PILOTING</span>
    <span class="pilot-sep" />
    <span v-if="pilot.carryKind" class="pilot-carry" :style="{ color: carryCol }">
      carrying {{ fmt(pilot.carryAmt, 1) }} / 20 {{ pilot.carryKind }}
    </span>
    <span v-else class="pilot-carry empty">empty-handed</span>
    <span class="pilot-sep" />
    <span class="pilot-hint">{{ hint }}</span>
    <span class="pilot-sep" />
    <span class="pilot-key">F: release</span>
  </div>
</template>

<style scoped>
.pilot {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 11px;
  align-self: center;
  margin-bottom: 6px;
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--ink);
  background: var(--panel);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(127, 212, 232, 0.3);
  border-radius: 4px;
  padding: 7px 13px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.pilot-tag {
  color: var(--cyan);
  letter-spacing: 0.16em;
  font-weight: 500;
}
.pilot-sep {
  width: 1px;
  height: 12px;
  background: var(--hair);
}
.pilot-carry { font-variant-numeric: tabular-nums; }
.pilot-carry.empty { color: var(--dim); }
.pilot-hint { color: var(--dim); }
.pilot-key {
  color: var(--faint);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
</style>
