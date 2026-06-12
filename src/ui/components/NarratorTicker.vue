<script lang="ts">
import type { Register } from "@/agent/council";

/** one glyph per council voice — colored for free by the .voice-* speaker rules */
export const GLYPHS: Record<Register, string> = {
  vivarium: "◉", // the keeper's eye
  watcher: "▲", // the sensor mast
  strategist: "◆", // the planner's marker
  chronicler: "§", // the archivist's section mark
};
</script>

<script setup lang="ts">
/* ============================================================================
   The council ticker — the narrator's single live line, a full-width bar on the
   absolute bottom edge of the screen. Shows only the LATEST utterance (typed
   out); the whole bar is a click target that pulls up the full log (LogOverlay).
   A severity ≥ 4 line announces itself with a finite rust flash.
   ============================================================================ */
import { computed, ref, watch } from "vue";
import { useColony } from "@/ui/stores/colony";
import TypedText from "./TypedText.vue";

const { messages, toggleLog } = useColony();

/** the line on the bar — always the newest message */
const latest = computed(() => (messages.value.length > 0 ? messages.value[messages.value.length - 1] : null));

// crit flash — armed by each new sev≥4 line, disarmed when the finite animation
// ends, so back-to-back crits can flash again
const crit = ref(false);
watch(latest, (m) => {
  if (m && m.sev >= 4) crit.value = true;
});
function onAnimEnd(e: AnimationEvent): void {
  if (e.animationName === "tickerflash") crit.value = false;
}
</script>

<template>
  <div
    class="ticker"
    :class="[{ crit }, latest ? 'voice-' + latest.register : '']"
    @click="toggleLog"
    @animationend="onAnimEnd"
  >
    <template v-if="latest">
      <span class="term-ts">[{{ latest.sol }}.{{ latest.clock }}]</span>
      <span class="term-speaker">{{ GLYPHS[latest.register] }} {{ latest.speaker }}</span>
      <TypedText :key="latest.id" :text="latest.text" />
    </template>
    <span v-else class="ticker-quiet" />
    <span class="ticker-chip">L ▸ LOG</span>
  </div>
</template>
