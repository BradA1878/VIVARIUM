<script setup lang="ts">
/* Top HUD bar: the VIVARIUM wordmark plus sim controls (storm, reset, pause,
   speed) and the settings gear. Mirrors the prototype TopBar — the HUD only
   issues commands and reads the snapshot, never the tick. */
import { computed, onUnmounted, ref } from "vue";
import { useColony } from "@/ui/stores/colony";
import { useSettings } from "@/ui/stores/settings";
import { closeGuide } from "./guide";
import { closeHelp, helpOpen, openHelp } from "./help";

const { snapshot, controls, capabilities } = useColony();
const { settingsOpen } = useSettings();
const s = computed(() => snapshot.value);
const canManageSimulation = computed(() => capabilities.value.canManageSimulation);

const speeds: readonly number[] = [1, 2, 4];

const resetArmed = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | null = null;
function cancelReset(): void {
  resetArmed.value = false;
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = null;
}
function armReset(): void {
  closeGuide();
  closeHelp();
  resetArmed.value = true;
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = setTimeout(cancelReset, 8_000);
}
function toggleSettings(): void {
  cancelReset();
  closeGuide();
  closeHelp();
  settingsOpen.value = !settingsOpen.value;
}
function showHelp(): void {
  cancelReset();
  closeGuide();
  settingsOpen.value = false;
  openHelp();
}
function confirmReset(): void {
  cancelReset();
  controls.reset();
}
onUnmounted(cancelReset);
</script>

<template>
  <header v-if="s" class="topbar">
    <div class="brand">
      <span class="brand-mark" />
      <span class="brand-name">VIVARIUM</span>
      <span class="brand-sub">life-support console · colony 7-MX</span>
    </div>
    <div class="controls">
      <button
        class="ctl"
        :class="{ on: helpOpen }"
        type="button"
        aria-haspopup="dialog"
        aria-controls="how-to-play"
        :aria-expanded="helpOpen"
        @click="showHelp"
      >
        ? how to play
      </button>

      <template v-if="canManageSimulation">
        <button
          class="ctl"
          type="button"
          title="Force a dust storm"
          :disabled="s.hazards.length > 0"
          @click="controls.storm()"
        >⛈ storm</button>
        <div class="reset-wrap">
          <button
            class="ctl"
            :class="{ warn: resetArmed }"
            type="button"
            aria-controls="reset-confirmation"
            :aria-expanded="resetArmed"
            @click="armReset"
          >
            ↺ reset
          </button>
          <div v-if="resetArmed" id="reset-confirmation" class="reset-confirm" role="status">
            <strong>BEGIN A NEW COLONY?</strong>
            <span>This replaces the current local autosave. There is no undo after confirmation.</span>
            <div class="reset-actions">
              <button type="button" @click="cancelReset">CANCEL</button>
              <button type="button" class="danger" @click="confirmReset">RESET COLONY</button>
            </div>
          </div>
        </div>
        <div class="ctl-sep" aria-hidden="true" />
      </template>

      <button
        v-if="canManageSimulation"
        class="ctl"
        :class="{ on: s.paused }"
        type="button"
        :aria-pressed="s.paused"
        @click="controls.togglePause()"
      >
        {{ s.paused ? "▶ resume" : "❚❚ pause" }}
      </button>
      <template v-if="canManageSimulation">
        <button
          v-for="sp in speeds"
          :key="sp"
          class="ctl spd"
          :class="{ on: s.speed === sp && !s.paused }"
          type="button"
          :aria-pressed="s.speed === sp && !s.paused"
          :aria-label="`${sp} times simulation speed`"
          @click="controls.setSpeed(sp)"
        >
          {{ sp }}×
        </button>
      </template>
      <div v-if="canManageSimulation" class="ctl-sep" aria-hidden="true" />
      <button
        class="ctl"
        :class="{ on: settingsOpen }"
        type="button"
        title="Settings"
        aria-haspopup="dialog"
        :aria-expanded="settingsOpen"
        @click="toggleSettings"
      >
        ⚙ settings
      </button>
    </div>
  </header>
</template>

<style scoped>
.reset-wrap { position: relative; }
.ctl.warn { color: var(--crit); border-color: rgba(232, 120, 79, 0.55); }
.reset-confirm {
  pointer-events: auto;
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: min(300px, calc(100vw - 24px));
  padding: 11px 12px;
  color: var(--ink);
  background: rgba(30, 13, 12, 0.97);
  border: 1px solid rgba(232, 120, 79, 0.55);
  border-radius: 4px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.62);
  font-size: 10px;
  line-height: 1.45;
  z-index: 80;
}
.reset-confirm strong { display: block; color: var(--crit); letter-spacing: 0.14em; margin-bottom: 4px; }
.reset-confirm span { display: block; color: var(--dim); }
.reset-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 10px; }
.reset-actions button { min-height: 32px; padding: 5px 9px; border: 1px solid var(--hair); border-radius: 3px; font-size: 9.5px; letter-spacing: 0.08em; }
.reset-actions button:hover { border-color: var(--dim); }
.reset-actions .danger { color: var(--crit); border-color: rgba(232, 120, 79, 0.55); }

@media (max-width: 760px) {
  .reset-confirm { position: fixed; top: 52px; right: 8px; }
}
</style>
