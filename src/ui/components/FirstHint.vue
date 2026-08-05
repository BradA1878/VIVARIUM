<script setup lang="ts">
/* A replayable, state-aware first-run watch. Each objective completes from the
   live snapshot, so the guide teaches the colony where the action happens and
   never asks the player to tick a checkbox by hand. */
import { computed, ref, watch } from "vue";
import { useColony } from "@/ui/stores/colony";
import {
  closeGuide,
  guideObjective,
  guideOpen,
  guideStageComplete,
  legacyHintSeen,
  loadGuideProgress,
  markLegacyHintSeen,
  nextGuideStage,
  saveGuideProgress,
  type GuideProgress,
  type GuideSnapshot,
} from "./guide";
import { fieldGuideHelpRequest } from "./help";

const { snapshot } = useColony();
const stored = loadGuideProgress();
const returningFromOldGuide = stored == null && legacyHintSeen();
const progress = ref<GuideProgress>(stored ?? {
  v: 2,
  stage: returningFromOldGuide ? "complete" : "food",
  skipped: returningFromOldGuide,
  miningCargoSeen: false,
  miningBaseline: null,
});
const intro = ref(stored == null && !returningFromOldGuide);

if (intro.value || (stored != null && stored.stage !== "complete")) guideOpen.value = true;

const guideSnapshot = computed<GuideSnapshot | null>(() => {
  const s = snapshot.value;
  if (!s) return null;
  return {
    buildings: s.buildings,
    colonists: s.colonists,
    possessed: s.possessed,
    solarMul: s.solarMul,
    materialsAmount: s.materials.amount,
  };
});

const stageNumber = computed(() => {
  if (progress.value.stage === "food") return 1;
  if (progress.value.stage === "power") return 2;
  if (progress.value.stage === "mining") return 3;
  return 3;
});

const objective = computed(() => {
  const s = guideSnapshot.value;
  const stage = progress.value.stage;
  if (!s || stage === "complete") return null;
  return guideObjective(stage, s, progress.value);
});

function persist(next: GuideProgress): void {
  progress.value = next;
  saveGuideProgress(next);
}

function startGuide(): void {
  intro.value = false;
  markLegacyHintSeen();
  persist({ v: 2, stage: "food", skipped: false, miningCargoSeen: false, miningBaseline: null });
  guideOpen.value = true;
}

function skipGuide(): void {
  intro.value = false;
  markLegacyHintSeen();
  persist({ v: 2, stage: "complete", skipped: true, miningCargoSeen: false, miningBaseline: null });
  closeGuide();
}

function replayGuide(): void {
  markLegacyHintSeen();
  persist({ v: 2, stage: "food", skipped: false, miningCargoSeen: false, miningBaseline: null });
  intro.value = false;
  guideOpen.value = true;
}

// The handbook can explicitly start, resume, or replay this stateful guide.
// A replay must reset progress rather than merely reopen the completed card.
watch(fieldGuideHelpRequest, (request) => {
  if (!request) return;
  if (request.intent === "replay") {
    replayGuide();
  } else if (request.intent === "start") {
    startGuide();
  } else {
    intro.value = false;
    guideOpen.value = true;
  }
});

watch(guideSnapshot, (s) => {
  if (!s || intro.value || progress.value.stage === "complete") return;
  let current = progress.value;
  if (current.stage === "mining" && current.miningBaseline == null) {
    current = { ...current, miningBaseline: s.materialsAmount };
    persist(current);
  }
  if (current.stage === "mining" && !current.miningCargoSeen) {
    const carryingOre = s.colonists.some((colonist) => (
      colonist.possessed && colonist.carryKind === "ore" && colonist.carryAmt > 0
    ));
    if (carryingOre) {
      current = { ...current, miningCargoSeen: true };
      persist(current);
    }
  }
  if (!guideStageComplete(current.stage, s, current)) return;
  const stage = nextGuideStage(current.stage);
  persist({
    ...current,
    stage,
    skipped: false,
    miningCargoSeen: stage === "mining" ? false : current.miningCargoSeen,
    miningBaseline: stage === "mining" ? s.materialsAmount : current.miningBaseline,
  });
}, { deep: false, immediate: true });
</script>

<template>
  <section
    v-if="guideOpen"
    id="field-guide"
    class="hint guide"
    aria-labelledby="guide-title"
    aria-live="polite"
  >
    <div class="hint-head">
      <span class="hint-brand">FIELD GUIDE</span>
      <span class="hint-sub">first watch</span>
      <button class="hint-x" type="button" title="Close guide" aria-label="Close field guide" @click="closeGuide">✕</button>
    </div>

    <template v-if="intro">
      <p id="guide-title" class="hint-flavor">Three live objectives. About three minutes. Always optional.</p>
      <p class="hint-copy">
        Learn the systems that end most first colonies: a sealed food loop, stored night power,
        and a hands-on materials run. The guide advances when the colony actually completes each task.
      </p>
      <div class="guide-preview" aria-label="Guide objectives">
        <span>01 · FOOD + PRESSURE</span>
        <span>02 · NIGHT + STORAGE</span>
        <span>03 · MINING + DEPOT</span>
      </div>
      <div class="hint-actions">
        <button class="hint-btn primary" type="button" @click="startGuide">START THE WATCH</button>
        <button class="hint-btn quiet" type="button" @click="skipGuide">SKIP FOR NOW</button>
      </div>
    </template>

    <template v-else-if="progress.stage !== 'complete' && objective">
      <div class="guide-progress" aria-label="Guide progress">
        <span v-for="n in 3" :key="n" :class="{ done: n < stageNumber, current: n === stageNumber }">{{ n }}</span>
      </div>
      <div class="guide-kicker">{{ objective.eyebrow }}</div>
      <h2 id="guide-title" class="guide-title">{{ objective.title }}</h2>
      <p class="hint-copy">{{ objective.body }}</p>
      <p class="hint-foot">{{ objective.hint }}</p>
      <div class="hint-actions">
        <button class="hint-btn quiet" type="button" @click="closeGuide">KEEP WATCHING</button>
        <button class="hint-btn text" type="button" @click="skipGuide">SKIP GUIDE</button>
      </div>
    </template>

    <template v-else>
      <div class="guide-complete" aria-hidden="true">✓</div>
      <p id="guide-title" class="hint-flavor">Field watch complete.</p>
      <p class="hint-copy">
        You have a pressure-aware food source, a night reserve, and the route from surface deposit to depot.
        Context hints will still appear when a new system matters.
      </p>
      <div class="hint-actions">
        <button class="hint-btn primary" type="button" @click="closeGuide">RETURN TO COLONY</button>
        <button class="hint-btn quiet" type="button" @click="replayGuide">REPLAY GUIDE</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.hint {
  pointer-events: auto;
  width: min(390px, calc(100vw - 28px));
  background: rgba(10, 15, 19, 0.94);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(127, 212, 232, 0.38);
  border-radius: 6px;
  padding: 16px 18px 15px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.68);
  font-family: var(--mono);
  color: var(--ink);
}
.hint-head { display: flex; align-items: baseline; gap: 9px; margin-bottom: 12px; }
.hint-brand { font-size: 13px; letter-spacing: 0.24em; color: #e6eef1; }
.hint-sub { flex: 1; font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); }
.hint-x { min-width: 28px; min-height: 28px; margin: -7px -7px -7px 0; color: var(--dim); border-radius: 3px; }
.hint-x:hover { color: var(--ink); background: rgba(127, 212, 232, 0.1); }
.hint-flavor {
  font-family: var(--serif);
  font-style: italic;
  font-size: 15px;
  line-height: 1.45;
  color: var(--cyan);
  margin: 0 0 11px;
}
.hint-copy { font-size: 11.5px; line-height: 1.55; color: var(--ink); margin: 0 0 12px; }
.guide-preview { display: grid; gap: 5px; padding: 9px 10px; margin-bottom: 13px; border: 1px solid var(--hair2); color: var(--dim); font-size: 9.5px; letter-spacing: 0.12em; }
.guide-progress { display: flex; gap: 7px; margin-bottom: 11px; }
.guide-progress span {
  display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%;
  border: 1px solid var(--hair); color: var(--faint); font-size: 9px;
}
.guide-progress span.done { color: #061013; border-color: var(--cyan); background: var(--cyan); }
.guide-progress span.current { color: var(--cyan); border-color: var(--cyan); box-shadow: 0 0 9px rgba(127, 212, 232, 0.35); }
.guide-kicker { color: var(--cyan); font-size: 9px; letter-spacing: 0.18em; margin-bottom: 6px; }
.guide-title { margin: 0 0 9px; font-family: var(--serif); font-size: 18px; font-style: italic; font-weight: 500; color: #e6eef1; }
.hint-foot { margin: 0 0 14px; color: var(--dim); font-size: 10px; line-height: 1.45; }
.hint-actions { display: flex; gap: 7px; flex-wrap: wrap; }
.hint-btn {
  min-height: 36px; flex: 1; font-size: 10.5px; letter-spacing: 0.1em; padding: 8px 10px;
  border-radius: 4px; border: 1px solid var(--hair); color: var(--dim); transition: 0.14s;
}
.hint-btn:hover { color: var(--ink); border-color: rgba(127, 212, 232, 0.5); }
.hint-btn.primary { color: #bfe9f2; border-color: rgba(127, 212, 232, 0.52); background: rgba(127, 212, 232, 0.1); }
.hint-btn.primary:hover { background: rgba(127, 212, 232, 0.2); }
.hint-btn.text { flex: 0 1 auto; border-color: transparent; }
.guide-complete { float: left; margin: 0 10px 4px 0; color: var(--cyan); font-size: 24px; }

@media (max-height: 680px) {
  .hint { max-height: calc(100dvh - 108px); overflow-y: auto; }
}
</style>
