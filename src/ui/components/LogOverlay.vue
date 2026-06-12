<script setup lang="ts">
/* ============================================================================
   The council log — the full message history as a bottom-left pull-up panel
   above the ticker. Lines render INSTANTLY (no typing); the typing performance
   belongs to the ticker. Auto-scrolls to the newest line on open and as new
   lines arrive.
   ============================================================================ */
import { nextTick, ref, watch } from "vue";
import { useColony } from "@/ui/stores/colony";
import { GLYPHS } from "./NarratorTicker.vue";

const { messages, logOpen, toggleLog } = useColony();
const body = ref<HTMLElement | null>(null);

function toBottom(): void {
  nextTick(() => {
    const el = body.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

watch(messages, toBottom, { deep: false });
watch(logOpen, (open) => {
  if (open) toBottom();
});
</script>

<template>
  <div v-if="logOpen" class="log-panel">
    <div class="log-head">
      <span class="log-title">THE COUNCIL — LOG</span>
      <button class="log-x" title="Close (Esc)" @click="toggleLog">✕</button>
    </div>
    <div ref="body" class="log-body">
      <div v-for="m in messages" :key="m.id" class="term-line" :class="'voice-' + m.register">
        <span class="term-ts">[{{ m.sol }}.{{ m.clock }}]</span>
        <span class="term-speaker">{{ GLYPHS[m.register] }} {{ m.speaker }}</span>
        <span class="term-txt">{{ m.text }}</span>
      </div>
    </div>
  </div>
</template>
