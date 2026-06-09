<script setup lang="ts">
/* ============================================================================
   PilotBar — the piloting bar (bottom-center, above the Inspector). Shown only
   while possessing a colonist. Surfaces the carry state and a CONTEXT prompt:
   stand on a deposit → "P: mine"; carry a load to the depot → "P: drop". The F
   key (release) and P key (interact) are bound in App.vue.
   ============================================================================ */
import { computed } from "vue";
import { useColony } from "../stores/colony";
import { fmt } from "../format";
import { PICKUP_RADIUS, DEPOT_RADIUS, CARRY_CAP } from "@/engine/tuning";

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

/** the action available right now where the colonist is standing */
const action = computed(() => {
  const s = snapshot.value;
  const p = pilot.value;
  if (!s || !p) return null;
  // drop the load at the depot
  if (p.carryAmt > 0 && p.carryKind && Math.hypot(s.depot.gx - p.x, s.depot.gy - p.y) <= DEPOT_RADIUS) {
    return { kind: "drop", text: `drop ${fmt(p.carryAmt, 0)} ${p.carryKind} into the depot`, col: carryCol.value };
  }
  // grab a load from a deposit in reach
  if (p.carryAmt < CARRY_CAP) {
    const dep = s.deposits.find(
      (d) => (!p.carryKind || p.carryKind === d.kind) && Math.hypot(d.gx - p.x, d.gy - p.y) <= PICKUP_RADIUS,
    );
    if (dep) return { kind: "mine", text: `mine ${dep.kind}`, col: CARRY_COL[dep.kind] };
  }
  return null;
});
</script>

<template>
  <div v-if="pilot" class="pilot">
    <span class="pilot-tag">&#9654; PILOTING</span>
    <span class="pilot-sep" />
    <span v-if="pilot.carryKind" class="pilot-carry" :style="{ color: carryCol }">
      carrying {{ fmt(pilot.carryAmt, 0) }} / {{ CARRY_CAP }} {{ pilot.carryKind }}
    </span>
    <span v-else class="pilot-carry empty">empty-handed</span>
    <span class="pilot-sep" />
    <span v-if="action" class="pilot-prompt" :style="{ '--c': action.col }">
      <b>P</b> — {{ action.text }}
    </span>
    <span v-else class="pilot-hint">
      Arrow keys / WASD to move · find a glowing deposit, then walk to the depot
    </span>
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
.pilot-tag { color: var(--cyan); letter-spacing: 0.16em; font-weight: 500; }
.pilot-sep { width: 1px; height: 12px; background: var(--hair); }
.pilot-carry { font-variant-numeric: tabular-nums; }
.pilot-carry.empty { color: var(--dim); }
.pilot-hint { color: var(--dim); }
.pilot-prompt {
  color: var(--c, var(--cyan));
  font-weight: 500;
  animation: pilot-pulse 1.1s ease-in-out infinite;
}
.pilot-prompt b {
  display: inline-block;
  min-width: 15px;
  text-align: center;
  padding: 1px 4px;
  margin-right: 3px;
  border: 1px solid currentColor;
  border-radius: 3px;
  font-weight: 700;
}
.pilot-key { color: var(--faint); letter-spacing: 0.12em; text-transform: uppercase; }
@keyframes pilot-pulse { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }
</style>
