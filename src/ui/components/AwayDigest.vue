<script setup lang="ts">
/* ============================================================================
   AwayDigest — the "while you were away" panel (parallel-colonies). When you
   switch to a colony you'd left behind, its off-screen catch-up (Colony.fastForward)
   ran real hazards, resupply, casualties and births deterministically. The store
   diffs the colony's before/after snapshots + tallies the off-screen events into an
   `awayDigest`; this surfaces that delta as readable lines so the absence is legible
   instead of silent. Dismissed by the player. A colony that DIED off-screen never
   reaches here — its EndScreen shows instead (the store returns a null digest then).
   ============================================================================ */
import { computed } from "vue";
import type { Resource } from "@shared/types";
import { awayDigest, dismissAwayDigest } from "@/ui/stores/colony";

const RES_ORDER: Resource[] = ["power", "water", "oxygen", "food"];

const d = computed(() => awayDigest.value);

/** the digest as readable lines, e.g. "3 sols passed", "lost 1 colonist",
 *  "weathered 2 hazards", "+40 materials" — only the parts that actually moved. */
const lines = computed<string[]>(() => {
  const g = d.value;
  if (!g) return [];
  const out: string[] = [];
  out.push(`${g.sols} ${g.sols === 1 ? "sol" : "sols"} passed`);
  if (g.casualties > 0) out.push(`lost ${g.casualties} ${g.casualties === 1 ? "colonist" : "colonists"}`);
  if (g.births > 0) out.push(`${g.births} ${g.births === 1 ? "birth" : "births"}`);
  if (g.popDelta !== 0) {
    out.push(`${g.popDelta > 0 ? "+" : "−"}${Math.abs(g.popDelta)} ${Math.abs(g.popDelta) === 1 ? "soul" : "souls"} net`);
  }
  if (g.hazards > 0) out.push(`weathered ${g.hazards} ${g.hazards === 1 ? "hazard" : "hazards"}`);
  if (g.destroyed > 0) out.push(`${g.destroyed} ${g.destroyed === 1 ? "building" : "buildings"} destroyed`);
  if (g.buildingDelta > 0) out.push(`+${g.buildingDelta} ${g.buildingDelta === 1 ? "building" : "buildings"} built`);
  return out;
});

/** the resource/material swings as signed chips, e.g. "+40 materials", "−12 water" */
const swings = computed<string[]>(() => {
  const g = d.value;
  if (!g) return [];
  const chips: string[] = [];
  for (const r of RES_ORDER) {
    const v = g.resourceSwing[r];
    if (v == null) continue;
    chips.push(`${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))} ${r}`);
  }
  if (Math.abs(g.materialsDelta) >= 1) {
    chips.push(`${g.materialsDelta >= 0 ? "+" : "−"}${Math.abs(Math.round(g.materialsDelta))} materials`);
  }
  return chips;
});
</script>

<template>
  <div v-if="d" class="away-scrim">
    <div class="panel away-card">
      <div class="away-eyebrow">WHILE YOU WERE AWAY</div>
      <div class="away-world">{{ d.label }}</div>
      <ul class="away-lines">
        <li v-for="line in lines" :key="line" :class="{ loss: line.startsWith('lost') || line.includes('destroyed') }">
          {{ line }}
        </li>
      </ul>
      <div v-if="swings.length" class="away-chips">
        <span
          v-for="chip in swings"
          :key="chip"
          class="away-chip"
          :class="{ up: chip.startsWith('+'), down: chip.startsWith('−') }"
        >{{ chip }}</span>
      </div>
      <button class="away-btn" @click="dismissAwayDigest">CARRY ON</button>
    </div>
  </div>
</template>

<style scoped>
/* a calm centered overlay, lighter than the EndScreen — the colony is fine, this is
   just a briefing. It sits below the EndScreen's z (40) so a dead world's screen wins. */
.away-scrim {
  position: absolute;
  inset: 0;
  z-index: 38;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(120% 100% at 50% 45%, rgba(6, 8, 11, 0.62), rgba(4, 5, 7, 0.82));
  animation: fadein 0.5s ease;
}
.away-card {
  border: 1px solid var(--hair);
  border-radius: 6px;
  padding: 22px 30px 24px;
  width: min(380px, 92vw);
  text-align: center;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.6);
}
.away-eyebrow {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.3em;
  color: var(--dim);
  margin-bottom: 10px;
}
.away-world {
  font-family: var(--serif);
  font-style: italic;
  font-size: 30px;
  letter-spacing: 0.04em;
  color: var(--cyan);
  text-shadow: 0 0 24px rgba(127, 212, 232, 0.35);
  margin-bottom: 18px;
}
.away-lines {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.away-lines li {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--ink);
}
.away-lines li.loss { color: var(--crit); }
.away-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-bottom: 20px;
}
.away-chip {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--ink);
  padding: 3px 9px;
  border: 1px solid var(--hair);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.02);
  white-space: nowrap;
}
.away-chip.up { color: var(--cyan); border-color: rgba(127, 212, 232, 0.4); }
.away-chip.down { color: var(--rust); border-color: rgba(200, 121, 79, 0.4); }
.away-btn {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--cyan);
  padding: 9px 24px;
  border: 1px solid rgba(127, 212, 232, 0.4);
  border-radius: 3px;
  transition: 0.15s;
}
.away-btn:hover { background: rgba(127, 212, 232, 0.1); border-color: var(--cyan); }
</style>
