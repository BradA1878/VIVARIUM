<script setup lang="ts">
/* ============================================================================
   VIVARIUM — App shell. The imperative three.js canvas (lazy-loaded, doc §1)
   under a Vue HUD overlay. The sim runs in a Web Worker behind SimBridge; the
   renderer and HUD only observe its snapshot/event stream (doc §0). The HUD is a
   pointer-events:none overlay; only the panels/controls opt back in (doc §4.3).
   ============================================================================ */
import { ref, computed, onMounted, onUnmounted, shallowRef } from "vue";
import Boot from "./components/Boot.vue";
import TopBar from "./components/TopBar.vue";
import SolClock from "./components/SolClock.vue";
import ResourceRail from "./components/ResourceRail.vue";
import Crew from "./components/Crew.vue";
import Objective from "./components/Objective.vue";
import Alerts from "./components/Alerts.vue";
import EndScreen from "./components/EndScreen.vue";
import StartScreen from "./components/StartScreen.vue";
import Curtain from "./components/Curtain.vue";
import NarratorTicker from "./components/NarratorTicker.vue";
import LogOverlay from "./components/LogOverlay.vue";
import Inspector from "./components/Inspector.vue";
import Palette from "./components/Palette.vue";
import TradePrompt from "./components/TradePrompt.vue";
import LaunchPrompt from "./components/LaunchPrompt.vue";
import ColoniesMap from "./components/ColoniesMap.vue";
import PilotBar from "./components/PilotBar.vue";
import FirstHint from "./components/FirstHint.vue";
import HintToast from "./components/HintToast.vue";
import SettingsModal from "./components/SettingsModal.vue";
import { SimBridge } from "@/worker/bridge";
import { Tuning } from "@/engine";
import type { ThreeRenderer } from "@/render/renderer";
import { initColony, useColony, disposeColony, directorDev } from "./stores/colony";
import { useSettings } from "./stores/settings";
import { audio } from "./audio";

const canvas = ref<HTMLCanvasElement | null>(null);
const booting = ref(true);
const bridge = shallowRef<SimBridge | null>(null);
const ready = ref(false);
let renderer: ThreeRenderer | null = null;

const { snapshot, clearTool, rotate, removeSelected, controls, logOpen, toggleLog, startScreen } = useColony();
const { settings, settingsOpen, updateSettings } = useSettings();
const storming = computed(() => snapshot.value?.weather === "dust");
const flaring = computed(() => snapshot.value?.hazards.some((h) => h.kind === "flare" && h.phase === "active") ?? false);

// WASD piloting — held keys become a standing move-intent for the possessed
// colonist. The keys are CAMERA-aligned: W goes "up the screen". The iso camera
// looks down the (1,·,1) diagonal, so screen-up maps to grid (-1,-1) and
// screen-right to grid (1,-1). Only sent while piloting.
const held = new Set<string>();
const Q = Math.SQRT1_2; // 0.7071 — unit diagonal
const MOVE_KEYS: Record<string, [number, number]> = {
  w: [-Q, -Q], s: [Q, Q], a: [-Q, Q], d: [Q, -Q],
  arrowup: [-Q, -Q], arrowdown: [Q, Q], arrowleft: [-Q, Q], arrowright: [Q, -Q],
};
function sendMove(): void {
  let dx = 0, dy = 0;
  for (const k of held) { const v = MOVE_KEYS[k]; if (v) { dx += v[0]; dy += v[1]; } }
  controls.moveIntent(dx, dy);
}
const piloting = computed(() => snapshot.value?.possessed != null);

function onKey(e: KeyboardEvent): void {
  const k = e.key.toLowerCase();
  if (e.key === "Escape") {
    // the settings modal swallows Esc first, then the council log, then the tool
    if (settingsOpen.value) { settingsOpen.value = false; return; }
    if (logOpen.value) { logOpen.value = false; return; }
    clearTool();
  }
  if (e.key === "f" || e.key === "F") { e.preventDefault(); clearTool(); controls.possessToggle(); held.clear(); return; }
  if (piloting.value && (k === "p" || k === "e")) { e.preventDefault(); controls.interact(); return; } // pick up / drop
  if (piloting.value && MOVE_KEYS[k]) {
    e.preventDefault();
    if (!held.has(k)) { held.add(k); sendMove(); }
    return;
  }
  if (e.key === " ") { e.preventDefault(); controls.togglePause(); }
  if (!piloting.value && (e.key === "r" || e.key === "R")) rotate(); // piloting locks construction
  if (k === "l") toggleLog(); // the council log — deliberately outside the held-keys movement path
  if (!piloting.value && (e.key === "Delete" || e.key === "Backspace")) removeSelected();
}
function onKeyUp(e: KeyboardEvent): void {
  const k = e.key.toLowerCase();
  if (held.has(k)) { held.delete(k); sendMove(); }
}

onMounted(async () => {
  const b = new SimBridge();
  bridge.value = b;

  const { ThreeRenderer } = await import("@/render/renderer");
  if (!canvas.value) return;
  renderer = new ThreeRenderer(canvas.value, b, Tuning.GRID_N);
  renderer.start();
  initColony(b, renderer);
  ready.value = true;

  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);

  if (import.meta.env.DEV) {
    (window as unknown as { __viv: unknown }).__viv = { renderer, bridge: b, settings, updateSettings, audio, director: directorDev };
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("keyup", onKeyUp);
  disposeColony();
  renderer?.dispose();
  bridge.value?.dispose();
});
</script>

<template>
  <div class="app">
    <canvas ref="canvas" class="stage"></canvas>
    <div class="vignette"></div>
    <div class="storm-veil" :class="{ on: storming }"></div>
    <div class="flare-veil" :class="{ on: flaring }"></div>

    <div class="hud" v-if="ready && !startScreen">
      <TopBar />

      <div class="left-col">
        <div class="panel rail">
          <SolClock />
          <ResourceRail />
          <Crew />
          <Objective />
        </div>
      </div>

      <div class="right-col">
        <Alerts />
        <TradePrompt />
        <LaunchPrompt />
        <ColoniesMap />
      </div>

      <NarratorTicker />
      <LogOverlay />

      <div class="bottom-center">
        <PilotBar />
        <Inspector />
        <Palette />
      </div>

      <SettingsModal />
    </div>

    <div v-if="!booting && !startScreen" class="hint-layer">
      <FirstHint />
      <HintToast />
    </div>

    <EndScreen v-if="!booting" />

    <StartScreen v-if="!booting && startScreen" />

    <Curtain />

    <Boot v-if="booting" @done="booting = false" />
  </div>
</template>

<style scoped>
/* the first-time hint sits centered near the top; only the card itself is
   interactive (the card opts back into pointer events) */
.hint-layer {
  position: absolute;
  top: 78px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 60;
}
</style>
