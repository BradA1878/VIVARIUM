<script setup lang="ts">
/* ============================================================================
   FirstHint — a one-time welcome card that teaches the core loop (build → gather
   → build). Shown on first play, dismissed forever once closed (localStorage).
   Plain-language on purpose; says "Arrow keys" rather than assuming WASD.
   ============================================================================ */
import { ref } from "vue";

const KEY = "vivarium:hinted:v1";
function seen(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
const dismissed = ref(seen());
function dismiss(): void {
  dismissed.value = true;
  try { localStorage.setItem(KEY, "1"); } catch { /* private mode — non-fatal */ }
}
</script>

<template>
  <div v-if="!dismissed" class="hint">
    <div class="hint-head">
      <span class="hint-brand">VIVARIUM</span>
      <span class="hint-sub">keeping a Mars colony alive</span>
    </div>

    <p class="hint-flavor">You build the colony. I keep what breathes here breathing.</p>

    <ol class="hint-steps">
      <li><b>Build</b> from the palette along the bottom. Each building costs <b>materials</b>.</li>
      <li>Out of materials? <b>Press F</b> to step into one of your astronauts — the view drops in close.</li>
      <li>Use the <b>Arrow keys</b> (or WASD) to walk out to a glowing <b>deposit</b> on the ground, and walk onto it to mine.</li>
      <li>Walk <b>back to the dome</b> to drop off your haul, then <b>press F</b> again to zoom back out.</li>
    </ol>

    <p class="hint-foot">Space = pause · R = rotate · click a building then the corridor tile then another to link them.</p>

    <button class="hint-btn" @click="dismiss">Got it — let me in</button>
  </div>
</template>

<style scoped>
.hint {
  pointer-events: auto;
  width: 340px;
  background: var(--panel);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(127, 212, 232, 0.32);
  border-radius: 6px;
  padding: 16px 18px 15px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  font-family: var(--mono);
  color: var(--ink);
}
.hint-head { display: flex; align-items: baseline; gap: 9px; margin-bottom: 11px; }
.hint-brand { font-size: 14px; letter-spacing: 0.26em; color: #e6eef1; }
.hint-sub { font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); }
.hint-flavor {
  font-family: var(--serif, Georgia, serif);
  font-style: italic;
  font-size: 13px;
  line-height: 1.4;
  color: var(--cyan);
  margin: 0 0 13px;
}
.hint-steps {
  margin: 0 0 12px;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.hint-steps li { font-size: 11.5px; line-height: 1.45; color: var(--ink); }
.hint-steps b { color: var(--cyan); font-weight: 600; }
.hint-foot {
  font-size: 9.5px;
  line-height: 1.4;
  color: var(--dim);
  margin: 0 0 14px;
  letter-spacing: 0.02em;
}
.hint-btn {
  width: 100%;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.1em;
  padding: 9px 0;
  border-radius: 4px;
  color: #bfe9f2;
  border: 1px solid rgba(127, 212, 232, 0.5);
  background: rgba(127, 212, 232, 0.1);
  transition: 0.14s;
}
.hint-btn:hover { background: rgba(127, 212, 232, 0.2); }
</style>
