<script setup lang="ts">
/* ============================================================================
   PilotBar — the piloting bar (bottom-center, above the Inspector). Shown while
   possessing a colonist OR driving a rover (one id space — the bar reads which
   it is from the snapshot). The suit branch names who you are (and their
   trade); the rover branch goes amber, reads the multi-kind cargo bed ("2 ice ·
   3 ore / 80"), and both surface a CONTEXT prompt: stand on a deposit → "P/E:
   mine/load"; carry a load to the depot → "P/E: drop/unload". The F key
   (release) and P/E keys (interact) are bound in App.vue.

   The commander: piloting the LEADER (ui/lead.ts) shows a CMDR tag, and when a
   functional rover sits within mounting range the F hint flips to "board rover"
   — that is what F actually does there (the store's possession chain).
   ============================================================================ */
import { computed, onMounted, onUnmounted } from "vue";
import { useColony } from "../stores/colony";
import { fmt } from "../format";
import { PICKUP_RADIUS, DEPOT_RADIUS, CARRY_CAP, ROVER_CARGO_CAP } from "@/engine/tuning";
import { CARGO_KINDS } from "@/engine/gather";
import { leaderId, boardableRover } from "../lead";

const { snapshot, controls, capabilities } = useColony();
const Q = Math.SQRT1_2;

const pilot = computed(() => {
  const s = snapshot.value;
  if (!s || s.possessed == null) return null;
  return s.colonists.find((c) => c.id === s.possessed) ?? null;
});

/** the possessed rover, when the possessed id is a machine instead of a suit */
const rover = computed(() => {
  const s = snapshot.value;
  if (!s || s.possessed == null) return null;
  return s.rovers.find((r) => r.id === s.possessed) ?? null;
});

const CARRY_COL: Record<"ice" | "ore" | "cache", string> = {
  ice: "#7fd4e8",
  ore: "#e0913a",
  cache: "#6fcf7f",
};
/** the rover chrome's amber — matches the ore/machine accent */
const AMBER = "#e0913a";

/** piloting the commander (the lowest living colonist id) */
const isCmdr = computed(() => {
  const s = snapshot.value;
  return !!s && pilot.value != null && pilot.value.id === leaderId(s);
});

/** the F key boards instead of releasing: leader piloted + a functional rover in range */
const canBoard = computed(() => {
  const s = snapshot.value;
  return !!s && isCmdr.value && boardableRover(s) != null;
});

const carryCol = computed(() =>
  pilot.value?.carryKind ? CARRY_COL[pilot.value.carryKind] : undefined,
);

/** the action available right now where the colonist is standing */
const action = computed(() => {
  const s = snapshot.value;
  const p = pilot.value;
  if (!s || !p) return null;
  // drop the load at the depot
  if (p.carryAmt > 0 && p.carryKind && Math.hypot(s.depot.gx - p.x, s.depot.gy - p.y) <= DEPOT_RADIUS) {
    return { kind: "drop", text: `drop ${fmt(p.carryAmt, 0)} ${p.carryKind} into the depot`, col: carryCol.value };
  }
  // grab a load from a deposit in reach
  if (p.carryAmt < CARRY_CAP) {
    const dep = s.deposits.find(
      (d) => (!p.carryKind || p.carryKind === d.kind) && Math.hypot(d.gx - p.x, d.gy - p.y) <= PICKUP_RADIUS,
    );
    if (dep) return { kind: "mine", text: `mine ${dep.kind}`, col: CARRY_COL[dep.kind] };
  }
  return null;
});

/** the rover's bed, kind by kind in the fixed bank order — "2 ice · 3 ore" */
const cargoText = computed(() => {
  const r = rover.value;
  if (!r) return "";
  return CARGO_KINDS
    .filter((k) => (r.cargo[k] ?? 0) > 0)
    .map((k) => `${fmt(r.cargo[k]!, 0)} ${k}`)
    .join(" · ");
});

/** the rover's context prompt — mirrors interactPossessed's machine branch:
 *  cargo aboard + depot in range → unload everything; otherwise any deposit in
 *  reach with bed headroom → load it (the bays take every kind) */
const roverAction = computed(() => {
  const s = snapshot.value;
  const r = rover.value;
  if (!s || !r) return null;
  if (r.cargoTotal > 0 && Math.hypot(s.depot.gx - r.x, s.depot.gy - r.y) <= DEPOT_RADIUS) {
    return { kind: "drop", text: `unload ${fmt(r.cargoTotal, 0)} cargo into the depot`, col: AMBER };
  }
  if (r.cargoTotal < ROVER_CARGO_CAP) {
    const dep = s.deposits.find((d) => Math.hypot(d.gx - r.x, d.gy - r.y) <= PICKUP_RADIUS);
    if (dep) return { kind: "load", text: `load ${dep.kind}`, col: CARRY_COL[dep.kind] };
  }
  return null;
});

const touchActionLabel = computed(() => {
  const current = action.value ?? roverAction.value;
  if (!current) return "ACTION";
  return current.kind === "drop" ? "UNLOAD" : current.kind === "load" ? "LOAD" : "MINE";
});

function startTouchMove(e: PointerEvent, dx: number, dy: number): void {
  (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
  controls.moveIntent(dx, dy);
}
function stopTouchMove(): void {
  controls.moveIntent(0, 0);
}
onMounted(() => {
  window.addEventListener("pointerup", stopTouchMove);
  window.addEventListener("pointercancel", stopTouchMove);
});
onUnmounted(() => {
  window.removeEventListener("pointerup", stopTouchMove);
  window.removeEventListener("pointercancel", stopTouchMove);
  stopTouchMove();
});
</script>

<template>
  <button
    v-if="capabilities.canPilot && snapshot && !pilot && !rover && snapshot.colonists.length"
    class="touch-enter"
    type="button"
    @click="controls.possessToggle()"
  >
    ▶ PILOT COMMANDER
  </button>
  <div v-if="pilot" class="pilot">
    <span class="pilot-tag">&#9654; PILOTING — <b v-if="isCmdr" class="cmdr">CMDR&nbsp;</b>{{ pilot.name.toUpperCase() }} · {{ pilot.role.toUpperCase() }}</span>
    <span class="pilot-sep" />
    <span v-if="pilot.carryKind" class="pilot-carry" :style="{ color: carryCol }">
      carrying {{ fmt(pilot.carryAmt, 0) }} / {{ CARRY_CAP }} {{ pilot.carryKind }}
    </span>
    <span v-else class="pilot-carry empty">empty-handed</span>
    <span class="pilot-sep" />
    <span v-if="action" class="pilot-prompt" :style="{ '--c': action.col }">
      <b>P / E</b> — {{ action.text }}
    </span>
    <span v-else class="pilot-hint">
      Arrow keys / WASD to move · find a glowing deposit, then walk to the depot
    </span>
    <span class="pilot-sep" />
    <span v-if="canBoard" class="pilot-key board">F: board rover</span>
    <span v-else class="pilot-key">F: release</span>
  </div>
  <div v-else-if="rover" class="pilot drive">
    <span class="pilot-tag drive-tag">&#9654; DRIVING — ROVER</span>
    <span class="pilot-sep" />
    <span v-if="rover.cargoTotal > 0" class="pilot-carry" :style="{ color: AMBER }">
      {{ cargoText }} / {{ ROVER_CARGO_CAP }}
    </span>
    <span v-else class="pilot-carry empty">bed empty / {{ ROVER_CARGO_CAP }}</span>
    <span class="pilot-sep" />
    <span v-if="roverAction" class="pilot-prompt" :style="{ '--c': roverAction.col }">
      <b>P / E</b> — {{ roverAction.text }}
    </span>
    <span v-else class="pilot-hint">
      Arrow keys / WASD to drive · the bed takes every kind — fill it, then make for the depot
    </span>
    <span class="pilot-sep" />
    <span class="pilot-key">F: release</span>
  </div>
  <div v-if="pilot || rover" class="touch-controls" aria-label="Touch pilot controls">
    <div class="touch-dpad">
      <button
        class="touch-move up"
        type="button"
        aria-label="Move up"
        @pointerdown.prevent="startTouchMove($event, -Q, -Q)"
        @pointerup="stopTouchMove"
        @pointercancel="stopTouchMove"
      >▲</button>
      <button
        class="touch-move left"
        type="button"
        aria-label="Move left"
        @pointerdown.prevent="startTouchMove($event, -Q, Q)"
        @pointerup="stopTouchMove"
        @pointercancel="stopTouchMove"
      >◀</button>
      <button
        class="touch-move right"
        type="button"
        aria-label="Move right"
        @pointerdown.prevent="startTouchMove($event, Q, -Q)"
        @pointerup="stopTouchMove"
        @pointercancel="stopTouchMove"
      >▶</button>
      <button
        class="touch-move down"
        type="button"
        aria-label="Move down"
        @pointerdown.prevent="startTouchMove($event, Q, Q)"
        @pointerup="stopTouchMove"
        @pointercancel="stopTouchMove"
      >▼</button>
    </div>
    <button
      class="touch-action"
      type="button"
      :disabled="!action && !roverAction"
      @click="controls.interact()"
    >{{ touchActionLabel }}</button>
    <button class="touch-release" type="button" @click="controls.possessToggle()">RELEASE</button>
  </div>
</template>

<style scoped>
.pilot {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 11px;
  align-self: center;
  margin-bottom: 6px;
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--ink);
  background: var(--panel);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(127, 212, 232, 0.3);
  border-radius: 4px;
  padding: 7px 13px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
/* the rover wears the machine amber instead of the suit cyan */
.pilot.drive { border-color: rgba(224, 145, 58, 0.35); }
.pilot-tag { color: var(--cyan); letter-spacing: 0.16em; font-weight: 500; }
.pilot-tag.drive-tag { color: #e0913a; }
.pilot-sep { width: 1px; height: 12px; background: var(--hair); }
.pilot-carry { font-variant-numeric: tabular-nums; }
.pilot-carry.empty { color: var(--dim); }
.pilot-hint { color: var(--dim); }
.pilot-prompt {
  color: var(--c, var(--cyan));
  font-weight: 500;
  animation: pilot-pulse 1.1s ease-in-out infinite;
}
.pilot-prompt b {
  display: inline-block;
  min-width: 15px;
  text-align: center;
  padding: 1px 4px;
  margin-right: 3px;
  border: 1px solid currentColor;
  border-radius: 3px;
  font-weight: 700;
}
.pilot-key { color: var(--faint); letter-spacing: 0.12em; text-transform: uppercase; }
/* the commander's rank tag + the contextual board prompt wear the leader amber */
.cmdr { color: #e0a23a; font-weight: 600; }
.pilot-key.board { color: #e0a23a; animation: pilot-pulse 1.1s ease-in-out infinite; }
@keyframes pilot-pulse { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }

.touch-enter,
.touch-controls { display: none; }

@media (pointer: coarse), (max-width: 900px) {
  .touch-enter {
    display: block;
    pointer-events: auto;
    min-height: 44px;
    padding: 8px 14px;
    color: var(--cyan);
    background: rgba(10, 15, 19, 0.94);
    border: 1px solid rgba(127, 212, 232, 0.42);
    border-radius: 4px;
    font-size: 10px;
    letter-spacing: 0.12em;
  }
  .pilot { max-width: 100%; flex-wrap: wrap; justify-content: center; font-size: 10px; }
  .pilot-sep { display: none; }
  .touch-controls {
    pointer-events: auto;
    display: grid;
    grid-template-columns: auto minmax(72px, auto);
    grid-template-rows: 1fr 1fr;
    gap: 7px;
    align-items: stretch;
    padding: 7px;
    background: rgba(10, 15, 19, 0.94);
    border: 1px solid rgba(127, 212, 232, 0.32);
    border-radius: 5px;
    touch-action: none;
  }
  .touch-dpad {
    grid-row: 1 / 3;
    display: grid;
    grid-template-columns: repeat(3, 44px);
    grid-template-rows: repeat(3, 36px);
    grid-template-areas: ". up ." "left . right" ". down .";
  }
  .touch-move,
  .touch-action,
  .touch-release {
    min-width: 44px;
    min-height: 36px;
    border: 1px solid var(--hair);
    border-radius: 3px;
    color: var(--ink);
    background: rgba(127, 212, 232, 0.06);
    font-size: 11px;
    user-select: none;
    -webkit-user-select: none;
  }
  .touch-move:active { color: var(--cyan); background: rgba(127, 212, 232, 0.2); }
  .touch-move.up { grid-area: up; }
  .touch-move.left { grid-area: left; }
  .touch-move.right { grid-area: right; }
  .touch-move.down { grid-area: down; }
  .touch-action { color: var(--cyan); border-color: rgba(127, 212, 232, 0.45); }
  .touch-action:disabled { color: var(--faint); border-color: var(--hair2); background: transparent; }
  .touch-release { color: var(--dim); font-size: 9px; letter-spacing: 0.1em; }
}
</style>
