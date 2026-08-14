<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { legacyHintSeen, loadGuideProgress } from "./guide";
import {
  closeHelp,
  fieldGuideIntentFor,
  helpOpen,
  requestFieldGuideFromHelp,
  type FieldGuideIntent,
} from "./help";
import { useColony } from "@/ui/stores/colony";

const dialog = ref<HTMLElement | null>(null);
const title = ref<HTMLHeadingElement | null>(null);
const guideIntent = ref<FieldGuideIntent>("start");
const { controls, mode, snapshot, startScreen } = useColony();
let restoreFocus: HTMLElement | null = null;
let ownsPause = false;

const FOCUSABLE = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const guideLabel = computed(() => {
  if (guideIntent.value === "replay") return "REPLAY FIELD GUIDE";
  if (guideIntent.value === "resume") return "RESUME FIELD GUIDE";
  return "START FIELD GUIDE";
});

watch(helpOpen, async (open) => {
  if (open) {
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    guideIntent.value = fieldGuideIntentFor(loadGuideProgress(), legacyHintSeen());
    ownsPause = mode.value === "solo" && !startScreen.value && snapshot.value != null && !snapshot.value.paused;
    if (ownsPause) controls.setPaused(true);
    await nextTick();
    title.value?.focus();
    return;
  }

  if (ownsPause) {
    ownsPause = false;
    controls.setPaused(false);
  }
  const target = restoreFocus;
  restoreFocus = null;
  await nextTick();
  if (target?.isConnected) target.focus();
});

function onDialogKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeHelp();
    return;
  }
  if (event.key !== "Tab" || !dialog.value) return;

  const focusable = [...dialog.value.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((element) => element.getAttribute("aria-hidden") !== "true");
  if (focusable.length === 0) {
    event.preventDefault();
    title.value?.focus();
    return;
  }

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === title.value || !dialog.value.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function showFieldGuide(): void {
  requestFieldGuideFromHelp(guideIntent.value);
}

onBeforeUnmount(() => {
  if (ownsPause) controls.setPaused(false);
  ownsPause = false;
  const target = restoreFocus;
  restoreFocus = null;
  if (target?.isConnected) target.focus();
});
</script>

<template>
  <div
    v-if="helpOpen"
    class="help-layer"
    data-shortcuts="off"
    @pointerdown.self="closeHelp"
    @keydown="onDialogKey"
  >
    <article
      id="how-to-play"
      ref="dialog"
      class="help-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      aria-describedby="help-intro"
    >
      <header class="help-head">
        <div>
          <span class="help-kicker">COLONY HANDBOOK</span>
          <h2 id="help-title" ref="title" tabindex="-1">HOW TO PLAY</h2>
        </div>
        <button class="help-close" type="button" aria-label="Close how to play" title="Close (Esc)" @click="closeHelp">
          <span aria-hidden="true">✕</span>
        </button>
      </header>

      <div class="help-body">
        <p id="help-intro" class="help-intro">
          Keep life support positive, grow the crew, and prove the settlement before Earth’s launch window closes.
        </p>

        <section class="help-section help-gather" aria-labelledby="help-gather-title">
          <h3 id="help-gather-title">MOVE + GATHER</h3>
          <dl class="help-keys primary-keys">
            <div class="help-key-row">
              <dt><kbd>F</kbd></dt>
              <dd>Pilot or release the commander.</dd>
            </div>
            <div class="help-key-row">
              <dt><kbd>WASD</kbd> <span>or</span> <kbd>ARROWS</kbd></dt>
              <dd>Move while piloting.</dd>
            </div>
            <div class="help-key-row">
              <dt><kbd>VIEW</kbd></dt>
              <dd>Use the on-screen + / − buttons or mouse wheel to zoom; left- or middle-drag to pan.</dd>
            </div>
            <div class="help-key-row">
              <dt><kbd>P</kbd> <span>or</span> <kbd>E</kbd></dt>
              <dd>Mine a nearby deposit, or unload when beside the depot.</dd>
            </div>
          </dl>

          <p class="help-unload">
            A carried load does not enter colony stores until you return to the illuminated depot beside the Pressure Hub and unload it.
          </p>
          <ul class="resource-map" aria-label="Deposit conversions">
            <li><b>ORE</b><span aria-hidden="true">→</span><span>MATERIALS</span></li>
            <li><b>ICE</b><span aria-hidden="true">→</span><span>WATER</span></li>
            <li><b>CACHE</b><span aria-hidden="true">→</span><span>FOOD</span></li>
          </ul>
          <p class="help-resupply">
            <b>EARTH RESUPPLY:</b> automatically adds power, water, oxygen, and food while the lander is present, as storage allows. No action is required.
          </p>
          <p class="touch-note">
            <b>TOUCH:</b> tap <em>PILOT COMMANDER</em>, use the direction pad, then tap <em>MINE</em> or <em>UNLOAD</em> when prompted.
          </p>
        </section>

        <section class="help-section" aria-labelledby="help-watch-title">
          <h3 id="help-watch-title">YOUR FIRST WATCH</h3>
          <ol class="first-watch">
            <li><b>Seal food.</b> Place Hydroponics and connect its door to the Pressure Hub with a Corridor.</li>
            <li><b>Prepare for night.</b> Keep generation ahead of demand and add a second Battery Bank.</li>
            <li><b>Bring home ore.</b> Materials pay for every expansion; mine a load and unload it at the depot.</li>
          </ol>
        </section>

        <section class="help-section help-hazards" aria-labelledby="help-hazards-title">
          <h3 id="help-hazards-title">SHELTER + INJURIES</h3>
          <p>
            When a hazard warning appears, unpiloted crew automatically head for the nearest connected, sealed shelter. Shelter protects them from quake jolts once they arrive; <b>piloted crew remain exposed until released</b>, even at a shelter door. One event cannot hit the same crew member twice. If a new meteor or quake arrives before a wound heals, another hit can be lethal. Wounded crew leave work and seek a powered, connected <b>Med-Bay</b> for faster treatment.
          </p>
        </section>

        <div class="help-columns">
          <section class="help-section compact" aria-labelledby="help-build-title">
            <h3 id="help-build-title">BUILDING</h3>
            <p>
              Choose a module from the lower palette and place it on open ground. For pressure, select <b>Corridor</b> and choose two sealed doors. Buildings need crew, power, and inputs before they produce.
            </p>
          </section>

          <section class="help-section compact" aria-labelledby="help-goal-title">
            <h3 id="help-goal-title">THE SETTLEMENT</h3>
            <p>
              Stabilize an eight-person outpost, then sustain twelve people with a working reactor, reserves, and a survived hazard. The Objective rail tracks the exact proof.
            </p>
          </section>
        </div>

        <section class="help-section compact help-traders" aria-labelledby="help-traders-title">
          <h3 id="help-traders-title">TRADERS + ALIEN TECH</h3>
          <p>
            Alien traders offer timed exchanges. A deal labeled <b>ALIEN TECH</b> costs materials and grants a permanent colony upgrade. Choose <b>INTEGRATE TECH</b> to accept it: the exact effect starts immediately, stays after the craft leaves, and remains listed in the Alien Tech panel.
          </p>
        </section>

        <details class="help-more">
          <summary>ALL CONTROLS</summary>
          <dl class="help-keys all-keys">
            <div class="help-key-row"><dt><kbd>F</kbd></dt><dd>Pilot or release; the commander can board a nearby rover.</dd></div>
            <div class="help-key-row"><dt><kbd>WASD</kbd> / <kbd>ARROWS</kbd></dt><dd>Move the piloted astronaut or rover.</dd></div>
            <div class="help-key-row"><dt><kbd>P</kbd> / <kbd>E</kbd></dt><dd>Mine, load, drop, or unload when a prompt appears.</dd></div>
            <div class="help-key-row"><dt><kbd>VIEW</kbd></dt><dd>Use + / − or the mouse wheel to zoom; left- or middle-drag to pan.</dd></div>
            <div class="help-key-row"><dt><kbd>SPACE</kbd></dt><dd>Pause or resume the simulation.</dd></div>
            <div class="help-key-row"><dt><kbd>R</kbd></dt><dd>Rotate the placement ghost or selected building.</dd></div>
            <div class="help-key-row"><dt><kbd>DELETE</kbd> / <kbd>BACKSPACE</kbd></dt><dd>Remove the selected building.</dd></div>
            <div class="help-key-row"><dt><kbd>ESC</kbd></dt><dd>Cancel the current tool or selection.</dd></div>
            <div class="help-key-row"><dt><kbd>L</kbd></dt><dd>Open or close the Council log.</dd></div>
          </dl>
        </details>

        <section class="help-section help-coop" aria-labelledby="help-coop-title">
          <h3 id="help-coop-title">CO-OP ROLES</h3>
          <p>
            The host is the architect: they build, control time, answer traders, and manage colonies. Guests embody astronauts and use the same pilot, movement, mining, and depot controls above.
          </p>
        </section>
      </div>

      <footer class="help-actions">
        <p v-if="startScreen">The hands-on Field Guide becomes available after you begin.</p>
        <p v-else>Want the hands-on version? The Field Guide follows three live objectives.</p>
        <div>
          <button v-if="!startScreen" class="help-guide" type="button" @click="showFieldGuide">{{ guideLabel }}</button>
          <button class="help-done" type="button" @click="closeHelp">CLOSE</button>
        </div>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.help-layer {
  position: absolute;
  inset: 0;
  z-index: 85;
  display: grid;
  place-items: center;
  padding:
    max(12px, env(safe-area-inset-top))
    max(12px, env(safe-area-inset-right))
    max(12px, env(safe-area-inset-bottom))
    max(12px, env(safe-area-inset-left));
  pointer-events: auto;
  background: rgba(3, 5, 7, 0.68);
  font-family: var(--mono);
}

.help-dialog {
  width: min(680px, 100%);
  max-height: calc(100dvh - 24px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--ink);
  background: rgba(10, 15, 19, 0.98);
  border: 1px solid rgba(127, 212, 232, 0.42);
  border-radius: 6px;
  box-shadow: 0 20px 58px rgba(0, 0, 0, 0.72);
}

.help-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px 13px;
  border-bottom: 1px solid var(--hair);
  background: rgba(12, 17, 21, 0.98);
}
.help-kicker {
  display: block;
  margin-bottom: 4px;
  color: var(--dim);
  font-size: 9px;
  letter-spacing: 0.22em;
}
.help-head h2 {
  margin: 0;
  color: #e6eef1;
  font-family: var(--serif);
  font-size: 23px;
  font-style: italic;
  font-weight: 500;
  letter-spacing: 0.07em;
  line-height: 1;
}
.help-close {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  display: grid;
  place-items: center;
  color: var(--dim);
  border: 1px solid transparent;
  border-radius: 3px;
  font-size: 12px;
}
.help-close:hover { color: var(--ink); border-color: var(--hair); background: rgba(127, 212, 232, 0.08); }

.help-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 18px 18px;
  scrollbar-color: rgba(127, 212, 232, 0.55) rgba(127, 212, 232, 0.07);
}
.help-body::-webkit-scrollbar { width: 5px; }
.help-body::-webkit-scrollbar-track { background: rgba(127, 212, 232, 0.07); }
.help-body::-webkit-scrollbar-thumb { background: rgba(127, 212, 232, 0.55); border-radius: 3px; }
.help-intro {
  max-width: 610px;
  margin: 0 0 15px;
  color: #d6e0e4;
  font-family: var(--serif);
  font-size: 15px;
  font-style: italic;
  line-height: 1.45;
}

.help-section { padding: 14px 0; border-top: 1px solid var(--hair2); }
.help-section h3 {
  margin: 0 0 10px;
  color: var(--cyan);
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.22em;
}
.help-section p,
.help-section li,
.help-key-row dd {
  color: var(--ink);
  font-size: 11px;
  line-height: 1.55;
}
.help-section b { color: #e6eef1; font-weight: 500; }
.help-gather {
  padding: 13px 14px 14px;
  border: 1px solid rgba(127, 212, 232, 0.28);
  background: rgba(127, 212, 232, 0.045);
}

.help-keys { margin: 0; }
.help-key-row {
  display: grid;
  grid-template-columns: 174px minmax(0, 1fr);
  gap: 12px;
  align-items: baseline;
  padding: 3px 0;
}
.help-key-row dt { color: var(--cyan); white-space: nowrap; }
.help-key-row dt span { color: var(--faint); font-size: 9px; }
kbd {
  display: inline-block;
  min-width: 24px;
  padding: 2px 6px;
  color: #d8f2f7;
  background: rgba(4, 8, 11, 0.75);
  border: 1px solid rgba(127, 212, 232, 0.38);
  border-radius: 3px;
  box-shadow: inset 0 -1px 0 rgba(127, 212, 232, 0.12);
  font-family: var(--mono);
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-align: center;
}
.help-unload {
  margin: 10px 0 9px;
  padding-left: 10px;
  border-left: 2px solid var(--rust);
}
.resource-map {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.resource-map li { display: flex; align-items: center; gap: 6px; color: var(--dim); letter-spacing: 0.05em; }
.resource-map li b { color: var(--rust); font-size: 9.5px; letter-spacing: 0.12em; }
.resource-map li span:last-child { color: var(--cyan); font-size: 9.5px; }
.help-resupply {
  margin: 10px 0 0;
  padding-left: 10px;
  border-left: 2px solid var(--cyan);
  color: var(--dim) !important;
}
.help-resupply b { color: var(--cyan); letter-spacing: 0.08em; }
.touch-note { margin-top: 10px; color: var(--dim) !important; font-size: 10px !important; }
.touch-note b { color: var(--cyan); letter-spacing: 0.1em; }
.touch-note em { color: var(--ink); font-style: normal; }

.first-watch { display: grid; gap: 7px; margin: 0; padding-left: 22px; }
.first-watch li { padding-left: 3px; }
.first-watch li::marker { color: var(--cyan); font-variant-numeric: tabular-nums; }

.help-hazards p {
  margin: 0;
  padding-left: 10px;
  border-left: 2px solid var(--rust);
}

.help-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
.help-section.compact { min-width: 0; }
.help-section.compact p { color: var(--dim); }

.help-more {
  border-top: 1px solid var(--hair2);
  border-bottom: 1px solid var(--hair2);
}
.help-more summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--dim);
  cursor: pointer;
  font-size: 9.5px;
  letter-spacing: 0.18em;
  list-style: none;
}
.help-more summary::-webkit-details-marker { display: none; }
.help-more summary::before { content: "+"; color: var(--cyan); font-size: 13px; }
.help-more[open] summary::before { content: "−"; }
.help-more summary:hover { color: var(--ink); }
.all-keys { padding: 0 0 13px; }
.all-keys .help-key-row { grid-template-columns: 174px minmax(0, 1fr); }
.help-coop p { color: var(--dim); }

.help-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 12px 18px;
  border-top: 1px solid var(--hair);
  background: rgba(12, 17, 21, 0.99);
}
.help-actions p {
  margin: 0;
  color: var(--dim);
  font-family: var(--serif);
  font-size: 12px;
  font-style: italic;
  line-height: 1.35;
}
.help-actions > div { display: flex; flex: 0 0 auto; gap: 7px; }
.help-guide,
.help-done {
  min-height: 40px;
  padding: 7px 11px;
  border: 1px solid var(--hair);
  border-radius: 3px;
  font-size: 9.5px;
  letter-spacing: 0.11em;
  white-space: nowrap;
}
.help-guide { color: #bfe9f2; border-color: rgba(127, 212, 232, 0.5); background: rgba(127, 212, 232, 0.09); }
.help-guide:hover { border-color: var(--cyan); background: rgba(127, 212, 232, 0.17); }
.help-done { color: var(--dim); }
.help-done:hover { color: var(--ink); border-color: rgba(127, 212, 232, 0.42); }

@media (max-width: 600px) {
  .help-layer { place-items: start center; padding: 8px; }
  .help-dialog { width: 100%; max-height: calc(100dvh - 16px); }
  .help-head { padding: 12px 13px 10px; }
  .help-head h2 { font-size: 21px; }
  .help-body { padding: 13px; }
  .help-gather { padding-inline: 11px; }
  .help-key-row,
  .all-keys .help-key-row { grid-template-columns: 152px minmax(0, 1fr); gap: 9px; }
  .help-columns { grid-template-columns: 1fr; gap: 0; }
  .help-actions { align-items: stretch; flex-direction: column; gap: 9px; padding: 10px 13px; }
  .help-actions > div { width: 100%; }
  .help-guide { flex: 1 1 auto; }
}

@media (max-width: 420px) {
  .help-key-row,
  .all-keys .help-key-row { grid-template-columns: 1fr; gap: 2px; padding-block: 5px; }
  .resource-map { display: grid; grid-template-columns: 1fr 1fr; }
  .help-actions > div { flex-wrap: wrap; }
  .help-guide,
  .help-done { min-height: 44px; }
}

@media (max-height: 560px) {
  .help-head { padding-block: 10px; }
  .help-kicker { display: none; }
  .help-actions p { display: none; }
}
</style>
