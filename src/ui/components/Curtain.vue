<script setup lang="ts">
/* ============================================================================
   Curtain — a brief full-screen fade that masks a colony SWITCH (parallel-
   colonies). The catch-up + world rebuild happen behind it, so the transition
   reads as a calm "jump to orbit → descend" rather than a one-frame mesh-storm.
   Fades in fast, out slow: cover quickly, reveal the new world gently.
   ============================================================================ */
import { curtain } from "../stores/colony";
</script>

<template>
  <transition name="curtain-fade">
    <div v-if="curtain" class="curtain">
      <div class="curtain-mark">&#9670; IN TRANSIT</div>
    </div>
  </transition>
</template>

<style scoped>
.curtain {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(120% 100% at 50% 45%, rgba(8, 10, 14, 0.9), rgba(3, 4, 6, 0.98));
  pointer-events: auto;
}
.curtain-mark {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.3em;
  color: #c7a6f2;
  opacity: 0.85;
  animation: transit-pulse 1.1s ease-in-out infinite;
}
@keyframes transit-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.9; } }

.curtain-fade-enter-active { transition: opacity 0.18s ease; }
.curtain-fade-leave-active { transition: opacity 0.5s ease; }
.curtain-fade-enter-from, .curtain-fade-leave-to { opacity: 0; }
</style>
