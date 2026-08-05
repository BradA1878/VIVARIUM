<script setup lang="ts">
/* ============================================================================
   ViewportGate → the Field Console (tier 2 mobile, spec 2026-08-05). Wide
   viewports: hidden. Below the 560×440 floor it is a FORK, not a wall —
   founding still needs a wider console, but JOINING a friend's colony as an
   astronaut works right here. While a guest session is connected the gate
   lifts (the phone HUD owns the screen); on failed/host-left it returns with
   the warning and the code still filled. ?join=CODE prefills the room code so
   a host can text an invite link. Visibility is reactive now — the old CSS
   media query moved into ui/viewport.ts (same FLOOR_QUERY).
   ============================================================================ */
import { computed, ref } from "vue";
import { useColony } from "../stores/colony";
import { belowFloor } from "../viewport";
import { consoleStatus, gateView, parseJoinCode } from "./fieldconsole";

const { mode, netStatus } = useColony();
const emit = defineEmits<{ join: [payload: { code: string; name: string }] }>();

const name = ref("");
const code = ref(parseJoinCode(typeof location !== "undefined" ? location.search : ""));

const view = computed(() => gateView(belowFloor.value, mode.value, netStatus.value));
const status = computed(() => consoleStatus(netStatus.value));
const joining = computed(() => netStatus.value === "connecting");

function join(): void {
  if (!code.value.trim() || joining.value) return;
  emit("join", { code: code.value.trim(), name: name.value.trim() || "Astronaut" });
}
</script>

<template>
  <div v-if="view === 'console'" class="viewport-gate" aria-labelledby="viewport-title">
    <div class="viewport-card">
      <div class="viewport-mark" aria-hidden="true">◇</div>
      <h1 id="viewport-title">FIELD CONSOLE</h1>
      <p>
        Founding a colony needs at least a 560 × 440 console.
        <strong>Joining one works right here.</strong>
      </p>

      <form class="gate-join" @submit.prevent="join">
        <label class="gj-field">
          <span class="gj-lbl">callsign</span>
          <input class="gj-in" v-model="name" maxlength="16" placeholder="your name" />
        </label>
        <label class="gj-field">
          <span class="gj-lbl">room code</span>
          <input class="gj-in" v-model="code" maxlength="24" placeholder="e.g. marsbase" />
        </label>
        <button class="gj-btn" type="submit" :disabled="!code.trim() || joining">
          &rarr; JOIN AS ASTRONAUT
        </button>
      </form>

      <p v-if="status" class="gate-status" :class="{ warn: status.warn }" aria-live="polite">
        {{ status.text }}
      </p>

      <span class="gate-foot">Your colony save remains intact. Solo play &rarr; a laptop or tablet.</span>
    </div>
  </div>
</template>

<style scoped>
.viewport-gate {
  position: absolute;
  inset: 0;
  z-index: 120;
  display: grid;
  /* card anchors in the upper half so the phone keyboard never covers the
     active field; the gate itself scrolls if it must */
  place-items: start center;
  overflow-y: auto;
  max-height: 100dvh;
  padding: max(24px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  pointer-events: auto;
  background: radial-gradient(120% 100% at 50% 40%, #0b1115, #040507);
  font-family: var(--mono);
}
.viewport-card { width: min(390px, 100%); margin-top: 5dvh; text-align: center; }
.viewport-mark { margin-bottom: 15px; color: var(--cyan); font-size: 30px; text-shadow: 0 0 18px rgba(127, 212, 232, 0.5); }
.viewport-card h1 { margin: 0 0 12px; color: #e6eef1; font-size: 14px; font-weight: 500; letter-spacing: 0.2em; }
.viewport-card p { margin: 0 0 14px; color: var(--ink); font-family: var(--serif); font-size: 15px; font-style: italic; line-height: 1.55; }
.viewport-card p strong { color: #9bd6a0; font-weight: 500; }

.gate-join { display: flex; flex-direction: column; gap: 8px; margin: 0 0 12px; text-align: left; }
.gj-field { display: flex; align-items: center; gap: 8px; }
.gj-lbl { flex: 0 0 72px; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
.gj-in {
  flex: 1;
  min-height: 44px;
  font-family: var(--mono);
  font-size: 14px;
  color: #e6eef1;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--hair2);
  border-radius: 3px;
  padding: 5px 9px;
}
.gj-in:focus { border-color: rgba(155, 214, 160, 0.6); }
.gj-btn {
  min-height: 48px;
  margin-top: 2px;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.14em;
  color: #9bd6a0;
  border: 1px solid rgba(155, 214, 160, 0.45);
  border-radius: 3px;
  background: rgba(155, 214, 160, 0.08);
}
.gj-btn:disabled { color: var(--faint); border-color: var(--hair2); background: transparent; }

.gate-status { margin: 0 0 12px; font-size: 11px; color: var(--dim); }
.gate-status.warn { color: #e07a5f; }
.gate-foot { color: var(--dim); font-size: 10px; letter-spacing: 0.08em; }
</style>
