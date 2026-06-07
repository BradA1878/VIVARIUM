<script setup lang="ts">
/* ============================================================================
   VIVARIUM — App shell. Wires the (lazy) imperative canvas under a Vue HUD
   overlay. In Phase 0 this is just the canvas + boot cold-open; the engine
   worker, renderer, HUD, and narrator are layered in by later phases.
   ============================================================================ */
import { ref } from "vue";
import Boot from "./components/Boot.vue";

const canvas = ref<HTMLCanvasElement | null>(null);
const booting = ref(true);
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
