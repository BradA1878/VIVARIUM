<script setup lang="ts">
/* ============================================================================
   StartScreen — the front door for a fresh game (doc: difficulty start screen).
   The VIVARIUM wordmark over three difficulty cards (CALM / STANDARD / BRUTAL);
   the worker's start gate holds the sim until the player picks one and presses
   Begin, so the colony sits static behind the screen. A resumed save never sees
   this — it ticks straight away (stores/colony.ts initColony). Numbers on the
   cards are pulled live from the engine's DIFFICULTY profiles, so they can't
   drift from balance. Begin routes through the store's start(difficulty) action.
   ============================================================================ */
import { ref, computed } from "vue";
import type { Difficulty, World } from "@shared/types";
import { Tuning } from "@/engine";
import { useColony } from "@/ui/stores/colony";
import { useSettings } from "@/ui/stores/settings";
import { WORLD_META } from "@/ui/founding";
import { audio } from "@/ui/audio";

const { controls, colonies } = useColony();
const { settings } = useSettings();

const { DIFFICULTY } = Tuning;

// the card copy — qualitative character, then concrete anchors (deadline sol +
// start materials) read live from the profile below so the words and the numbers
// can never disagree with tuning.ts.
interface Card {
  value: Difficulty;
  label: string;
  tagline: string;
  grace: string;
  hazards: string;
}
const CARDS: Card[] = [
  {
    value: "easy",
    label: "CALM",
    tagline: "Room to learn the colony before it tests you.",
    grace: "long grace — pools sit empty a while before they bite",
    hazards: "gentler, rarer hazards",
  },
  {
    value: "normal",
    label: "STANDARD",
    tagline: "The balance the colony is tuned around.",
    grace: "measured grace on an empty pool",
    hazards: "hazards at their intended pace",
  },
  {
    value: "hard",
    label: "BRUTAL",
    tagline: "A lean start and a planet that does not wait.",
    grace: "short grace — a starved pool turns lethal fast",
    hazards: "fiercer, more frequent hazards",
  },
];

// open on whatever the player last chose (the standing "next run" default), so
// this screen and the Settings picker agree.
const selected = ref<Difficulty>(settings.value.nextDifficulty);

function choose(d: Difficulty): void {
  if (selected.value === d) return;
  selected.value = d;
  audio.uiTick();
}

function begin(): void {
  audio.uiTick();
  controls.start(selected.value); // lifts the worker gate on the chosen profile + greets
}

// settled worlds from the Colonies ledger — revisiting loads that slot and resumes
// the colony live (the Round-4 entry point). Newest first.
const ledger = computed(() => colonies());
const worldLabel = (id: string): string => WORLD_META[id as World]?.label ?? id;
function revisit(slotKey: string): void {
  audio.uiTick();
  void controls.revisit(slotKey);
}
</script>

<template>
  <div class="startscreen">
    <div class="start-inner">
      <div class="start-mark">VIVARIUM</div>
      <div class="start-sub">choose the terms of the colony</div>

      <div class="start-cards">
        <button
          v-for="c in CARDS"
          :key="c.value"
          class="start-card"
          :class="{ on: selected === c.value }"
          @click="choose(c.value)"
        >
          <div class="card-label">{{ c.label }}</div>
          <div class="card-tag">{{ c.tagline }}</div>
          <ul class="card-facts">
            <li>
              launch window closes
              <b>sol {{ DIFFICULTY[c.value].deadlineSol }}</b>
            </li>
            <li>
              start with
              <b>{{ DIFFICULTY[c.value].startMaterials }}</b> materials
            </li>
            <li>{{ c.grace }}</li>
            <li>{{ c.hazards }}</li>
          </ul>
        </button>
      </div>

      <button class="start-btn" @click="begin">BEGIN</button>

      <div v-if="ledger.length" class="start-colonies">
        <div class="start-colonies-label">— or return to a colony —</div>
        <div class="colony-list">
          <button
            v-for="c in ledger"
            :key="c.slotKey"
            class="colony-chip"
            @click="revisit(c.slotKey)"
          >
            <span class="colony-world">{{ worldLabel(c.worldId) }}</span>
            <span class="colony-meta">{{ c.sols }} {{ c.sols === 1 ? "sol" : "sols" }} · {{ c.population }} souls</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* full-viewport curtain over the (static) colony — same radial wash as the end
   screen, one layer below the settings/hint stack */
.startscreen {
  position: absolute;
  inset: 0;
  z-index: 45;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(120% 100% at 50% 42%, rgba(6, 8, 11, 0.82), rgba(4, 5, 7, 0.95));
  animation: fadein 0.6s ease;
}
.start-inner {
  text-align: center;
  width: min(880px, 94vw);
  padding: 0 24px;
}
.start-mark {
  font-family: var(--serif);
  font-style: italic;
  font-size: 54px;
  letter-spacing: 0.08em;
  color: #e6eef1;
  text-shadow: 0 0 24px rgba(127, 212, 232, 0.4);
  margin-bottom: 10px;
}
.start-sub {
  font-family: var(--serif);
  font-style: italic;
  font-size: 15px;
  color: var(--dim);
  letter-spacing: 0.04em;
  margin-bottom: 30px;
}

.start-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 30px;
  text-align: left;
}
.start-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 16px 16px 18px;
  background: var(--panel);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--hair);
  border-radius: 5px;
  transition: 0.16s;
  cursor: pointer;
}
.start-card:hover {
  border-color: rgba(127, 212, 232, 0.4);
}
.start-card.on {
  border-color: rgba(127, 212, 232, 0.6);
  background: rgba(127, 212, 232, 0.08);
  box-shadow: 0 0 28px rgba(127, 212, 232, 0.14);
}
.card-label {
  font-family: var(--mono);
  font-size: 13px;
  letter-spacing: 0.26em;
  color: var(--ink);
}
.start-card.on .card-label {
  color: var(--cyan);
}
.card-tag {
  font-family: var(--serif);
  font-style: italic;
  font-size: 13px;
  line-height: 1.45;
  color: var(--dim);
  min-height: 38px;
}
.card-facts {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 2px;
}
.card-facts li {
  font-family: var(--mono);
  font-size: 10.5px;
  line-height: 1.4;
  letter-spacing: 0.02em;
  color: var(--dim);
  padding-left: 11px;
  position: relative;
}
.card-facts li::before {
  content: "·";
  position: absolute;
  left: 0;
  color: var(--faint);
}
.card-facts b {
  color: #e6eef1;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.start-card.on .card-facts b {
  color: var(--cyan);
}

.start-btn {
  font-size: 12px;
  letter-spacing: 0.26em;
  color: var(--cyan);
  padding: 12px 40px;
  border: 1px solid rgba(127, 212, 232, 0.45);
  border-radius: 3px;
  transition: 0.15s;
}
.start-btn:hover {
  background: rgba(127, 212, 232, 0.12);
  border-color: var(--cyan);
  box-shadow: 0 0 22px rgba(127, 212, 232, 0.2);
}

/* the Colonies ledger — revisit a settled world (PTP). A quiet row of chips
   under BEGIN, in the launch prompt's purple so it reads as the planet-hop. */
.start-colonies { margin-top: 28px; }
.start-colonies-label {
  font-family: var(--serif);
  font-style: italic;
  font-size: 12px;
  color: var(--faint);
  letter-spacing: 0.04em;
  margin-bottom: 12px;
}
.colony-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.colony-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 13px;
  border-radius: 4px;
  border: 1px solid rgba(176, 130, 232, 0.35);
  background: rgba(176, 130, 232, 0.05);
  transition: 0.14s;
  cursor: pointer;
}
.colony-chip:hover { background: rgba(176, 130, 232, 0.15); border-color: rgba(176, 130, 232, 0.6); }
.colony-world { font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; color: #c7a6f2; }
.colony-meta { font-family: var(--mono); font-size: 9px; letter-spacing: 0.04em; color: var(--dim); }

@media (max-width: 720px) {
  .start-cards { grid-template-columns: 1fr; }
  .card-tag { min-height: 0; }
}
</style>
