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
import Alerts from "./components/Alerts.vue";
import Terminal from "./components/Terminal.vue";
import Inspector from "./components/Inspector.vue";
import Palette from "./components/Palette.vue";
import { SimBridge } from "@/worker/bridge";
import { Tuning } from "@/engine";
import type { ThreeRenderer } from "@/render/renderer";
import { initColony, useColony, pushLine } from "./stores/colony";

const canvas = ref<HTMLCanvasElement | null>(null);
const booting = ref(true);
const bridge = shallowRef<SimBridge | null>(null);
const ready = ref(false);
let renderer: ThreeRenderer | null = null;

const { snapshot, clearTool, controls } = useColony();
const storming = computed(() => snapshot.value?.weather === "dust");

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") clearTool();
  if (e.key === " ") { e.preventDefault(); controls.togglePause(); }
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

  // first words — the scripted narrator (Phase 7) takes over the voice from here
  setTimeout(() => pushLine("I am VIVARIUM. I keep what breathes here breathing. Begin."), 900);

  window.addEventListener("keydown", onKey);

  if (import.meta.env.DEV) {
    (window as unknown as { __viv: unknown }).__viv = { renderer, bridge: b };
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  renderer?.dispose();
  bridge.value?.dispose();
});
</script>

<template>
  <div class="app">
    <canvas ref="canvas" class="stage"></canvas>
    <div class="vignette"></div>
    <div class="storm-veil" :class="{ on: storming }"></div>

    <div class="hud" v-if="ready">
      <TopBar />

      <div class="left-col">
        <div class="panel rail">
          <SolClock />
          <ResourceRail />
          <Crew />
        </div>
      </div>

      <div class="right-col">
        <Alerts />
      </div>

      <div class="bottom-left">
        <Terminal />
      </div>

      <div class="bottom-center">
        <Inspector />
        <Palette />
      </div>
    </div>

    <Boot v-if="booting" @done="booting = false" />
  </div>
</template>
