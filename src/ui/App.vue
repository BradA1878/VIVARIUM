<script setup lang="ts">
/* ============================================================================
   VIVARIUM — App shell. Wires the imperative three.js canvas (lazy-loaded so the
   heavy renderer stays off the main bundle, doc §1) under a Vue HUD overlay. The
   sim runs in a Web Worker behind SimBridge; the renderer and HUD only observe
   its snapshot/event stream (doc §0). HUD chrome lands in Phase 5.
   ============================================================================ */
import { ref, onMounted, onUnmounted, shallowRef } from "vue";
import Boot from "./components/Boot.vue";
import { SimBridge } from "@/worker/bridge";
import { Tuning } from "@/engine";
import type { ThreeRenderer } from "@/render/renderer";

const canvas = ref<HTMLCanvasElement | null>(null);
const booting = ref(true);
const bridge = shallowRef<SimBridge | null>(null);
let renderer: ThreeRenderer | null = null;

onMounted(async () => {
  const b = new SimBridge();
  bridge.value = b;

  // lazy-load the three.js renderer chunk now that we're showing the colony
  const { ThreeRenderer } = await import("@/render/renderer");
  if (!canvas.value) return;
  renderer = new ThreeRenderer(canvas.value, b, Tuning.GRID_N);
  renderer.start();

  // dev-only handle so tests can drive tools before the HUD palette (Phase 5)
  if (import.meta.env.DEV) {
    (window as unknown as { __viv: unknown }).__viv = { renderer, bridge: b };
  }
});

onUnmounted(() => {
  renderer?.dispose();
  bridge.value?.dispose();
});
</script>

<template>
  <div class="app">
    <canvas ref="canvas" class="stage"></canvas>
    <div class="vignette"></div>

    <!-- HUD overlay regions are added in Phase 5. -->
    <div class="hud"></div>

    <Boot v-if="booting" @done="booting = false" />
  </div>
</template>
