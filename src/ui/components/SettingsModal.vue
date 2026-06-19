<script setup lang="ts">
/* ============================================================================
   SettingsModal — the console's preferences panel, opened from the TopBar gear
   (Esc also closes it, wired in App.vue). Every control writes through
   updateSettings so changes persist immediately; the colony store's deep watch
   applies quality/director live, the narrator gate reads narratorLive per event,
   and nextDifficulty takes hold on the next reset.
   ============================================================================ */
import { ref, watch } from "vue";
import { useSettings } from "@/ui/stores/settings";
import { liveNarratorHealthy } from "@/agent/client";
import type { Difficulty } from "@shared/types";

const { settings, settingsOpen, updateSettings } = useSettings();

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
  ["F", "possess / release the nearest colonist"],
  ["WASD / arrows", "walk while piloting (camera-aligned)"],
  ["P / E", "pick up at a deposit · drop at the depot"],
  ["Space", "pause / resume"],
  ["R", "rotate the ghost or selected building"],
  ["Del", "remove the selected building"],
  ["Esc", "cancel tool · close this panel"],
  ["corridor", "click a building, the corridor tile, then another to link"],
];
</script>

<template>
  <div v-if="settingsOpen" class="settings-layer">
    <div class="settings">
      <div class="set-head">
        <span class="set-brand">SETTINGS</span>
        <span class="set-sub">console preferences</span>
        <button class="set-x" title="Close (Esc)" @click="settingsOpen = false">✕</button>
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
            @input="setVol(k, $event)"
          />
          <span class="set-val">{{ Math.round(settings.audio[k] * 100) }}%</span>
        </label>
        <div class="set-row">
          <span class="set-label">mute</span>
          <button
            class="set-toggle"
            :class="{ on: settings.audio.muted }"
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
            :disabled="!liveAvailable"
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
            @click="updateSettings({ directorEnabled: !settings.directorEnabled })"
          >
            {{ settings.directorEnabled ? "ON" : "OFF" }}
          </button>
        </div>
        <p class="set-note">the planet adapts to you</p>
      </section>

      <section class="set-sec">
        <h3 class="set-title">NEXT RUN</h3>
        <div class="set-chips">
          <button
            v-for="d in DIFFS"
            :key="d.value"
            class="set-chip"
            :class="{ on: settings.nextDifficulty === d.value }"
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
  pointer-events: none;
  z-index: 60;
}
.settings {
  pointer-events: auto;
  width: min(380px, 88vw);
  max-height: 80vh;
  overflow-y: auto;
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
.set-brand { font-size: 14px; letter-spacing: 0.26em; color: #e6eef1; }
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
</style>
