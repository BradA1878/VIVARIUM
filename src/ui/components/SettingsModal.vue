<script setup lang="ts">
/* ============================================================================
   SettingsModal — the console's preferences panel, opened from the TopBar gear
   (Esc also closes it, wired in App.vue). Every control writes through
   updateSettings so changes persist immediately; the colony store's deep watch
   applies quality/director live, the narrator gate reads narratorLive per event,
   and nextDifficulty takes hold on the next reset.
   ============================================================================ */
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useSettings } from "@/ui/stores/settings";
import { useColony } from "@/ui/stores/colony";
import { liveNarratorHealthy } from "@/agent/client";
import type { Difficulty } from "@shared/types";

const { settings, settingsOpen, updateSettings } = useSettings();
const { mode, capabilities } = useColony();
const panel = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
let restoreFocus: HTMLElement | null = null;

// the live narrator needs the Hono backend; without the opt-in flag the client
// never calls it, so the toggle renders disabled rather than lying
const liveAvailable = import.meta.env.VITE_LIVE_NARRATOR === "1";

// honesty over polish: if the client's circuit breaker is open, the council is
// speaking from the scripted bank no matter what the toggle says. Sampled once
// each time the panel opens — display only, no polling, narration untouched.
const narratorHealthy = ref(true);
watch(settingsOpen, (open) => {
  if (open) narratorHealthy.value = liveNarratorHealthy();
}, { immediate: true });

const FOCUSABLE = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

watch(settingsOpen, async (open) => {
  if (open) {
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    closeButton.value?.focus();
    return;
  }
  const target = restoreFocus;
  restoreFocus = null;
  await nextTick();
  if (target?.isConnected) target.focus();
});

function closeModal(): void {
  settingsOpen.value = false;
}

function onDialogKey(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeModal();
    return;
  }
  if (e.key !== "Tab" || !panel.value) return;
  const focusable = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (focusable.length === 0) {
    e.preventDefault();
    panel.value.focus();
    return;
  }
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

onBeforeUnmount(() => {
  const target = restoreFocus;
  restoreFocus = null;
  if (target?.isConnected) target.focus();
});

type VolKey = "master" | "sfx" | "ambient";
const VOLS: VolKey[] = ["master", "sfx", "ambient"];
function setVol(key: VolKey, e: Event): void {
  const v = Number((e.target as HTMLInputElement).value);
  updateSettings({ audio: { [key]: v } as Partial<{ master: number; sfx: number; ambient: number }> });
}

const QUALITIES: ("auto" | "low" | "high")[] = ["auto", "low", "high"];

const DIFFS: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "CALM" },
  { value: "normal", label: "STANDARD" },
  { value: "hard", label: "BRUTAL" },
];

// the real bindings, as bound in App.vue onKey
const KEYS: [string, string][] = [
  ["F", "pilot / release the commander · board a nearby rover"],
  ["WASD / arrows", "walk while piloting (camera-aligned)"],
  ["P / E", "pick up at a deposit · unload at the depot"],
  ["Mouse", "left / middle-drag to pan · wheel to zoom"],
  ["Space", "pause / resume"],
  ["R", "rotate the ghost or selected building"],
  ["Del / Backspace", "remove the selected building"],
  ["L", "open / close the council log"],
  ["Esc", "cancel tool · close this panel"],
  ["corridor", "select Corridor, then choose two sealed building doors"],
];
</script>

<template>
  <div
    v-if="settingsOpen"
    class="settings-layer"
    data-shortcuts="off"
    @pointerdown.self="closeModal"
    @keydown="onDialogKey"
  >
    <div
      ref="panel"
      class="settings"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
    >
      <div class="set-head">
        <h2 id="settings-title" class="set-brand">SETTINGS</h2>
        <span class="set-sub">console preferences</span>
        <button ref="closeButton" class="set-x" type="button" title="Close (Esc)" aria-label="Close settings" @click="closeModal">✕</button>
      </div>

      <section class="set-sec">
        <h3 class="set-title">AUDIO</h3>
        <label v-for="k in VOLS" :key="k" class="set-row">
          <span class="set-label">{{ k }}</span>
          <input
            class="set-range"
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="settings.audio[k]"
            :disabled="settings.audio.muted"
            :aria-label="`${k} volume`"
            @input="setVol(k, $event)"
          />
          <span class="set-val">{{ Math.round(settings.audio[k] * 100) }}%</span>
        </label>
        <div class="set-row">
          <span class="set-label">mute</span>
          <button
            class="set-toggle"
            :class="{ on: settings.audio.muted }"
            type="button"
            :aria-pressed="settings.audio.muted"
            @click="updateSettings({ audio: { muted: !settings.audio.muted } })"
          >
            {{ settings.audio.muted ? "ON" : "OFF" }}
          </button>
        </div>
      </section>

      <section class="set-sec">
        <h3 class="set-title">GRAPHICS</h3>
        <div class="set-row">
          <span class="set-label">quality</span>
          <div class="set-seg">
            <button
              v-for="q in QUALITIES"
              :key="q"
              class="set-seg-btn"
              :class="{ on: settings.graphics.quality === q }"
              type="button"
              :aria-pressed="settings.graphics.quality === q"
              @click="updateSettings({ graphics: { quality: q } })"
            >
              {{ q.toUpperCase() }}
            </button>
          </div>
        </div>
        <p class="set-note">AUTO adapts to your machine</p>
      </section>

      <section class="set-sec">
        <h3 class="set-title">NARRATOR</h3>
        <div class="set-row">
          <span class="set-label">live voice</span>
          <button
            class="set-toggle"
            :class="{ on: liveAvailable && settings.narratorLive }"
            type="button"
            :disabled="!liveAvailable"
            :aria-pressed="liveAvailable && settings.narratorLive"
            @click="updateSettings({ narratorLive: !settings.narratorLive })"
          >
            {{ settings.narratorLive ? "ON" : "OFF" }}
          </button>
        </div>
        <p v-if="!liveAvailable" class="set-note">narrator server not configured</p>
        <p v-else-if="settings.narratorLive && !narratorHealthy" class="set-note">
          server unreachable — speaking from the script
        </p>
      </section>

      <section class="set-sec">
        <h3 class="set-title">DIRECTOR</h3>
        <div class="set-row">
          <span class="set-label">director</span>
          <button
            class="set-toggle"
            :class="{ on: settings.directorEnabled }"
            type="button"
            :disabled="!capabilities.canManageSimulation"
            :aria-pressed="settings.directorEnabled"
            @click="updateSettings({ directorEnabled: !settings.directorEnabled })"
          >
            {{ settings.directorEnabled ? "ON" : "OFF" }}
          </button>
        </div>
        <p class="set-note">
          {{ mode === "guest" ? "the host controls this run; your preference remains for solo play" : "the planet adapts to you" }}
        </p>
      </section>

      <section class="set-sec">
        <h3 class="set-title">NEXT RUN</h3>
        <div class="set-chips">
          <button
            v-for="d in DIFFS"
            :key="d.value"
            class="set-chip"
            :class="{ on: settings.nextDifficulty === d.value }"
            type="button"
            :aria-pressed="settings.nextDifficulty === d.value"
            @click="updateSettings({ nextDifficulty: d.value })"
          >
            {{ d.label }}
          </button>
        </div>
        <p class="set-note">takes effect on the next reset</p>
      </section>

      <section class="set-sec last">
        <h3 class="set-title">KEYS</h3>
        <table class="set-keys">
          <tbody>
            <tr v-for="[k, what] in KEYS" :key="k">
              <td class="set-key">{{ k }}</td>
              <td class="set-what">{{ what }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* full-viewport centering layer — only the card itself is interactive */
.settings-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  z-index: 60;
  padding: 18px;
  background: rgba(3, 5, 7, 0.48);
}
.settings {
  pointer-events: auto;
  width: min(400px, 100%);
  max-height: calc(100dvh - 36px);
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--panel);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(127, 212, 232, 0.32);
  border-radius: 6px;
  padding: 16px 18px 15px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  font-family: var(--mono);
  color: var(--ink);
}

.set-head { display: flex; align-items: baseline; gap: 9px; margin-bottom: 12px; }
.set-brand { margin: 0; font-size: 14px; font-weight: 500; letter-spacing: 0.26em; color: #e6eef1; }
.set-sub { flex: 1; font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); }
.set-x { font-size: 11px; color: var(--dim); padding: 2px 5px; border-radius: 3px; transition: 0.14s; }
.set-x:hover { color: var(--ink); background: rgba(127, 212, 232, 0.1); }

.set-sec { padding: 10px 0 11px; border-top: 1px solid var(--hair2); }
.set-sec.last { padding-bottom: 2px; }
.set-title { font-size: 9.5px; font-weight: 500; letter-spacing: 0.24em; color: var(--dim); margin: 0 0 8px; }

.set-row { display: flex; align-items: center; gap: 10px; padding: 3px 0; }
.set-label { width: 86px; flex: 0 0 auto; font-size: 10.5px; letter-spacing: 0.08em; color: var(--ink); }
.set-val { width: 38px; text-align: right; font-size: 10px; color: var(--dim); font-variant-numeric: tabular-nums; }
.set-note {
  font-family: var(--serif);
  font-style: italic;
  font-size: 11.5px;
  color: var(--dim);
  margin: 5px 0 0;
}

.set-range {
  flex: 1;
  appearance: none;
  -webkit-appearance: none;
  height: 3px;
  border-radius: 2px;
  background: rgba(127, 212, 232, 0.18);
  accent-color: var(--cyan);
  outline: none;
}
.set-range::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 8px rgba(127, 212, 232, 0.5);
  cursor: pointer;
}
.set-range::-moz-range-thumb {
  width: 11px;
  height: 11px;
  border: none;
  border-radius: 50%;
  background: var(--cyan);
  cursor: pointer;
}
.set-range:disabled { opacity: 0.35; }
.set-range:focus-visible { outline-offset: 5px; }
.set-range:disabled::-webkit-slider-thumb { cursor: default; box-shadow: none; background: var(--dim); }
.set-range:disabled::-moz-range-thumb { cursor: default; background: var(--dim); }

.set-toggle,
.set-chip,
.set-seg-btn {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--dim);
  padding: 4px 10px;
  border: 1px solid var(--hair);
  border-radius: 3px;
  transition: 0.14s;
}
.set-toggle:hover:not(:disabled),
.set-chip:hover,
.set-seg-btn:hover { color: var(--ink); border-color: rgba(127, 212, 232, 0.4); }
.set-toggle.on,
.set-chip.on,
.set-seg-btn.on {
  color: var(--cyan);
  border-color: rgba(127, 212, 232, 0.5);
  background: rgba(127, 212, 232, 0.1);
}
.set-toggle:disabled { opacity: 0.4; cursor: default; }

.set-seg { display: inline-flex; }
.set-seg-btn { border-radius: 0; margin-left: -1px; }
.set-seg-btn:first-child { border-radius: 3px 0 0 3px; margin-left: 0; }
.set-seg-btn:last-child { border-radius: 0 3px 3px 0; }

.set-chips { display: flex; gap: 6px; }

.set-keys { width: 100%; border-collapse: collapse; }
.set-keys td { padding: 3px 0; font-size: 10px; line-height: 1.45; vertical-align: top; }
.set-key { width: 96px; color: var(--cyan); letter-spacing: 0.08em; white-space: nowrap; padding-right: 10px; }
.set-what { color: var(--dim); }

@media (max-height: 680px), (max-width: 520px) {
  .settings-layer { align-items: flex-start; padding: 8px; }
  .settings { width: 100%; max-height: calc(100dvh - 16px); padding: 14px; }
  .set-row { gap: 8px; }
  .set-label { width: 74px; }
  .set-keys td { font-size: 10.5px; }
}
</style>
