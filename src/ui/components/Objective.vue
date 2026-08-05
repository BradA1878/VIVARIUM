<script setup lang="ts">
/* The campaign is deliberately shown as two proofs: first stabilize the starter
   loop, then prove an advanced settlement across crew, reactor, hazard, launch
   branch, materials, and a full day/night cycle. */
import { computed } from "vue";
import { buildingFunctional, Tuning } from "@/engine";
import { useColony } from "@/ui/stores/colony";
import { fmt } from "@/ui/format";

const { snapshot } = useColony();
const s = computed(() => snapshot.value);

const OUTPOST_POP = Tuning.SETTLEMENT_POP;
const OUTPOST_GOAL = Tuning.SETTLEMENT_SUSTAIN_GOAL;
const POD_MATERIALS = 200;

const windowPct = computed(() => {
  if (!s.value) return 0;
  const span = s.value.deadlineSol - 1;
  return Math.max(0, Math.min(1, (s.value.sol - 1) / Math.max(1, span)));
});
const solsLeft = computed(() => (s.value ? Math.max(0, s.value.deadlineSol - s.value.sol) : 0));
const outpostPct = computed(() => (
  s.value ? Math.max(0, Math.min(1, s.value.settlementSustainableFor / OUTPOST_GOAL)) : 0
));
const proofPct = computed(() => (
  s.value ? Math.max(0, Math.min(1, s.value.selfSufficientFor / s.value.selfSufficiencyGoal)) : 0
));
const reactorOnline = computed(() => s.value?.buildings.some((building) => (
  building.defId === "reactor"
  && building.online
  && building.staffed
  && building.fed
  && building.util > 0
  && buildingFunctional(building)
)) ?? false);
const hazardProven = computed(() => (s.value?.hazardsSurvived ?? 0) > 0);
const ptpUnlocked = computed(() => s.value?.unlocks.ptp === true);
const podMaterialsReady = computed(() => (s.value?.materials.amount ?? 0) >= POD_MATERIALS);
</script>

<template>
  <section v-if="s" class="objective" aria-labelledby="objective-title">
    <h2 id="objective-title" class="obj-title">OBJECTIVE · SELF-SUFFICIENCY</h2>

    <div class="obj-row">
      <span class="obj-k">LAUNCH WINDOW</span>
      <span class="obj-v" :class="{ warn: solsLeft <= 3 }">{{ solsLeft }} sols left</span>
    </div>
    <div
      class="obj-bar"
      role="progressbar"
      aria-label="Launch window elapsed"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="Math.round(windowPct * 100)"
    >
      <div class="obj-fill window" :style="{ width: windowPct * 100 + '%' }" />
    </div>

    <div class="obj-stage" :class="{ done: s.settlementEstablished }">
      <div class="obj-stage-head">
        <span>STAGE 1 · OUTPOST</span>
        <b>{{ s.settlementEstablished ? "PROVEN" : "ACTIVE" }}</b>
      </div>
      <div class="obj-row">
        <span class="obj-k">CREW</span>
        <span class="obj-v" :class="{ ok: s.population >= OUTPOST_POP }">{{ s.population }}/{{ OUTPOST_POP }}</span>
      </div>
      <div class="obj-row">
        <span class="obj-k">POSITIVE BALANCE</span>
        <span class="obj-v" :class="{ ok: s.settlementEstablished }">
          {{ fmt(s.settlementSustainableFor) }}/{{ fmt(OUTPOST_GOAL) }}s
        </span>
      </div>
      <div
        class="obj-bar"
        role="progressbar"
        aria-label="Outpost positive balance proof"
        aria-valuemin="0"
        :aria-valuemax="OUTPOST_GOAL"
        :aria-valuenow="Math.round(s.settlementSustainableFor)"
      >
        <div class="obj-fill suff" :style="{ width: outpostPct * 100 + '%' }" />
      </div>
    </div>

    <div class="obj-stage proof" :class="{ locked: !s.settlementEstablished }">
      <div class="obj-stage-head">
        <span>STAGE 2 · SETTLEMENT PROOF</span>
        <b>{{ s.settlementEstablished ? "ACTIVE" : "LOCKED" }}</b>
      </div>
      <div class="obj-row">
        <span class="obj-k">CREW</span>
        <span class="obj-v" :class="{ ok: s.population >= s.targetPop }">{{ s.population }}/{{ s.targetPop }}</span>
      </div>
      <div class="obj-row">
        <span class="obj-k">REACTOR ONLINE</span>
        <span class="obj-v" :class="{ ok: reactorOnline }">{{ reactorOnline ? "READY" : "NEEDED" }}</span>
      </div>
      <div class="obj-row">
        <span class="obj-k">HAZARD SURVIVED</span>
        <span class="obj-v" :class="{ ok: hazardProven }">{{ Math.min(1, s.hazardsSurvived) }}/1</span>
      </div>
      <div class="obj-row">
        <span class="obj-k">PTP SCHEMATIC</span>
        <span class="obj-v" :class="{ ok: ptpUnlocked }">{{ ptpUnlocked ? "UNLOCKED" : "LOCKED" }}</span>
      </div>
      <div class="obj-row">
        <span class="obj-k">POD MATERIALS</span>
        <span class="obj-v" :class="{ ok: podMaterialsReady }">{{ fmt(s.materials.amount) }}/{{ POD_MATERIALS }}</span>
      </div>
      <div class="obj-row proof-time">
        <span class="obj-k">FULL-SOL BALANCE</span>
        <span class="obj-v" :class="{ ok: proofPct >= 1 }">
          {{ fmt(s.selfSufficientFor) }}/{{ fmt(s.selfSufficiencyGoal) }}s
        </span>
      </div>
      <div
        class="obj-bar"
        role="progressbar"
        aria-label="Full-sol settlement proof"
        aria-valuemin="0"
        :aria-valuemax="s.selfSufficiencyGoal"
        :aria-valuenow="Math.round(s.selfSufficientFor)"
      >
        <div class="obj-fill suff" :style="{ width: proofPct * 100 + '%' }" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.obj-title { font-weight: 500; }
.obj-stage { margin-top: 11px; padding-top: 9px; border-top: 1px solid var(--hair2); }
.obj-stage-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 4px; }
.obj-stage-head span { font-size: 8.5px; letter-spacing: 0.17em; color: #d7e2e6; }
.obj-stage-head b { font-size: 8px; font-weight: 500; letter-spacing: 0.11em; color: var(--cyan); }
.obj-stage.locked .obj-stage-head b { color: var(--faint); }
.obj-stage.locked .obj-row { opacity: 0.72; }
.obj-stage.done .obj-stage-head span { color: var(--cyan); }
.proof-time { margin-top: 8px; }
.obj-stage.proof { display: grid; grid-template-columns: 1fr 1fr; column-gap: 10px; }
.proof .obj-stage-head,
.proof .proof-time,
.proof .obj-bar { grid-column: 1 / -1; }
.proof > .obj-row:not(.proof-time) { min-width: 0; margin-top: 4px; gap: 5px; }
.proof > .obj-row:not(.proof-time) .obj-k { font-size: 8px; letter-spacing: 0.08em; }
.proof > .obj-row:not(.proof-time) .obj-v { font-size: 10.5px; }
</style>
