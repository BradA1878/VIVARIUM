<script setup lang="ts">
/* ============================================================================
   VIVARIUM — App shell. The imperative three.js canvas (lazy-loaded, doc §1)
   under a Vue HUD overlay. The sim runs in a Web Worker behind SimBridge; the
   renderer and HUD only observe its snapshot/event stream (doc §0). The HUD is a
   pointer-events:none overlay; only the panels/controls opt back in (doc §4.3).
   ============================================================================ */
import { ref, computed, onMounted, onUnmounted, shallowRef, watch } from "vue";
import Boot from "./components/Boot.vue";
import TopBar from "./components/TopBar.vue";
import SolClock from "./components/SolClock.vue";
import ResourceRail from "./components/ResourceRail.vue";
import Crew from "./components/Crew.vue";
import Objective from "./components/Objective.vue";
import AlienTechStatus from "./components/AlienTechStatus.vue";
import Alerts from "./components/Alerts.vue";
import EndScreen from "./components/EndScreen.vue";
import StartScreen from "./components/StartScreen.vue";
import AwayDigest from "./components/AwayDigest.vue";
import Curtain from "./components/Curtain.vue";
import NarratorTicker from "./components/NarratorTicker.vue";
import LogOverlay from "./components/LogOverlay.vue";
import Inspector from "./components/Inspector.vue";
import Palette from "./components/Palette.vue";
import TradePrompt from "./components/TradePrompt.vue";
import LaunchPrompt from "./components/LaunchPrompt.vue";
import ColoniesMap from "./components/ColoniesMap.vue";
import Lobby from "./components/Lobby.vue";
import PilotBar from "./components/PilotBar.vue";
import FirstHint from "./components/FirstHint.vue";
import HintToast from "./components/HintToast.vue";
import SettingsModal from "./components/SettingsModal.vue";
import HelpModal from "./components/HelpModal.vue";
import ViewportGate from "./components/ViewportGate.vue";
import VitalsStrip from "./components/VitalsStrip.vue";
import { belowFloor } from "./viewport";
import { helpOpen } from "./components/help";
import { blocksGameplayKeys, isNativeActivationTarget } from "./components/keyboard";
import { SimBridge, type BridgeCore } from "@/worker/bridge";
import { Tuning } from "@/engine";
import type { ThreeRenderer } from "@/render/renderer";
import { initColony, useColony, disposeColony, directorDev, setMode, setRoster, netStatus, type ColonyMode } from "./stores/colony";
import { joinNetRoom, type NetRoom, type RosterMsg } from "@/net/room";
import { HostRelay } from "@/net/hostRelay";
import { NetBridge } from "@/net/netBridge";
import { useSettings } from "./stores/settings";
import { audio } from "./audio";

const canvas = ref<HTMLCanvasElement | null>(null);
const booting = ref(true);
const bridge = shallowRef<BridgeCore | null>(null);
const ready = ref(false);
const bootFailure = ref<{ message: string; detail: string } | null>(null);
const bootRetrying = ref(false);
let renderer: ThreeRenderer | null = null;

const {
  snapshot, tool, demolish, hover, selected, clearTool, rotate, removeSelected,
  controls, logOpen, toggleLog, startScreen, capabilities, simError, dismissSimError,
  mode,
} = useColony();

/** phone astronaut mode (tier 2): a guest below the 560×440 floor sheds the
 *  HUD to the cockpit (VitalsStrip + PilotBar + ticker). Rotating above the
 *  floor simply deactivates it — both inputs are live refs. */
const phoneGuest = computed(() => belowFloor.value && mode.value === "guest");
function reloadApp(): void { window.location.reload(); }
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

function clearHeld(): void {
  if (held.size === 0) return;
  held.clear();
  controls.moveIntent(0, 0);
}

function onKey(e: KeyboardEvent): void {
  if (!ready.value || startScreen.value || snapshot.value?.outcome) return;
  if (settingsOpen.value || helpOpen.value || e.defaultPrevented || blocksGameplayKeys(e.target)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.key === "Escape") {
    if (logOpen.value) { e.preventDefault(); logOpen.value = false; return; }
    if (capabilities.value.canBuild && (tool.value || demolish.value || selected.value)) {
      e.preventDefault();
      clearTool();
    }
    return;
  }
  if (
    k === "f" && !e.repeat && capabilities.value.canPilot
    && (snapshot.value?.possessed != null || (snapshot.value?.colonists.length ?? 0) > 0)
  ) {
    e.preventDefault();
    clearTool();
    controls.possessToggle();
    clearHeld();
    return;
  }
  if (piloting.value && (k === "p" || k === "e")) { e.preventDefault(); controls.interact(); return; } // pick up / drop
  if (piloting.value && MOVE_KEYS[k]) {
    e.preventDefault();
    if (!held.has(k)) { held.add(k); sendMove(); }
    return;
  }
  if (e.key === " " && !isNativeActivationTarget(e.target) && capabilities.value.canManageSimulation) {
    e.preventDefault();
    controls.togglePause();
    return;
  }
  if (!piloting.value && capabilities.value.canBuild && k === "r" && (tool.value || selected.value || hover.value?.defId)) {
    e.preventDefault();
    rotate();
    return;
  }
  if (k === "l" && !e.repeat) {
    e.preventDefault();
    toggleLog();
    return;
  }
  if (!piloting.value && capabilities.value.canBuild && selected.value && (e.key === "Delete" || e.key === "Backspace")) {
    e.preventDefault();
    removeSelected();
  }
}

// A pointer can open a modal while a movement key is held. Stop the standing
// intent immediately so the astronaut never keeps walking behind an overlay.
watch([settingsOpen, helpOpen], ([settingsShown, helpShown]) => {
  if (settingsShown || helpShown) clearHeld();
});
function onKeyUp(e: KeyboardEvent): void {
  const k = e.key.toLowerCase();
  if (held.has(k)) { held.delete(k); sendMove(); }
}

// co-op session handles (null in solo)
let netRoom: NetRoom | null = null;
let hostRelay: HostRelay | null = null;

/** stand up a renderer + store on a bridge (worker for solo/host, Trystero for a
 *  guest). The bridge IS the network seam, so this path is identical either way. */
async function boot(b: BridgeCore, m: ColonyMode): Promise<void> {
  bridge.value = b;
  const { ThreeRenderer } = await import("@/render/renderer");
  if (!canvas.value) throw new Error("rendering canvas is unavailable");
  renderer = new ThreeRenderer(canvas.value, b, Tuning.GRID_N);
  renderer.start();
  initColony(b, renderer, m);
  ready.value = true;
  if (import.meta.env.DEV) {
    (window as unknown as { __viv: unknown }).__viv = { renderer, bridge: b, settings, updateSettings, audio, director: directorDev };
  }
}

function describeBootFailure(err: unknown): { message: string; detail: string } {
  const detail = err instanceof Error ? err.message : String(err);
  return {
    message: "The colony renderer could not start. VIVARIUM needs WebGL2 and hardware-accelerated graphics in a current browser.",
    detail,
  };
}

async function startLocal(): Promise<void> {
  if (bootRetrying.value) return;
  bootRetrying.value = true;
  bootFailure.value = null;
  try {
    await boot(new SimBridge(), "solo");
  } catch (err) {
    console.error("[vivarium] renderer/bootstrap failed:", err);
    teardown();
    bootFailure.value = describeBootFailure(err);
  } finally {
    bootRetrying.value = false;
  }
}

/** tear down the live bridge/renderer/store + any co-op session */
function teardown(): void {
  const clean = (label: string, fn: (() => void) | undefined): void => {
    if (!fn) return;
    try { fn(); } catch (err) { console.warn(`[vivarium] ${label} cleanup failed:`, err); }
  };
  const relay = hostRelay; hostRelay = null;
  const room = netRoom; netRoom = null;
  const activeRenderer = renderer; renderer = null;
  const activeBridge = bridge.value; bridge.value = null;
  clean("host relay", relay ? () => relay.dispose() : undefined);
  clean("network room", room ? () => room.leave() : undefined);
  clean("colony store", disposeColony);
  clean("renderer", activeRenderer ? () => activeRenderer.dispose() : undefined);
  clean("bridge", activeBridge ? () => activeBridge.dispose() : undefined);
  ready.value = false;
  netStatus.value = "idle";
}

/** roster → the lobby panel + the floating name tags over each astronaut */
function applyRoster(r: RosterMsg): void {
  setRoster(r.players);
  if (netStatus.value === "connecting") netStatus.value = "connected"; // the host answered
  const names = new Map<number, string>();
  for (const p of r.players) if (p.actorId != null) names.set(p.actorId, p.name);
  renderer?.setPlayerNames(names, bridge.value?.localActor ?? null);
}

/** HOST: keep the live worker sim, open a room, relay it to guests, and become the
 *  architect (localActor=null → not embodied → can build + see the overview). */
function hostGame(code: string, name: string): void {
  const b = bridge.value;
  if (!b || netRoom) return;
  try {
    netRoom = joinNetRoom(code);
    hostRelay = new HostRelay(netRoom, b, name, applyRoster); // host gets its roster locally
    b.localActor = null;
    setMode("host");
  } catch (err) {
    console.error("[vivarium] hosting failed:", err);
    netRoom?.leave(); netRoom = null; hostRelay = null;
  }
}

/** GUEST: drop the local worker and embody an astronaut on the host's colony. */
async function joinGame(code: string, name: string): Promise<void> {
  teardown();
  netStatus.value = "connecting"; // NetBridge's join window reports a timeout if nobody answers
  try {
    netRoom = joinNetRoom(code);
    netRoom.onRoster(applyRoster);
    await boot(new NetBridge(netRoom, name), "guest");
  } catch (err) {
    console.error("[vivarium] join failed:", err);
    const failure = !ready.value ? describeBootFailure(err) : null;
    teardown();
    netStatus.value = "failed";
    if (failure) bootFailure.value = failure;
  }
}

// Lobby panel → session lifecycle
function onHost(p: { code: string; name: string }): void { hostGame(p.code, p.name); }
function onJoin(p: { code: string; name: string }): void { void joinGame(p.code, p.name); }

onMounted(async () => {
  await startLocal();

  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clearHeld);

  if (import.meta.env.DEV) {
    (window as unknown as { __net: unknown }).__net = { host: hostGame, join: joinGame };
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("blur", clearHeld);
  clearHeld();
  teardown();
});
</script>

<template>
  <div class="app">
    <canvas ref="canvas" class="stage" aria-label="Interactive three-dimensional colony surface"></canvas>
    <div class="vignette"></div>
    <div class="storm-veil" :class="{ on: storming }"></div>
    <div class="flare-veil" :class="{ on: flaring }"></div>

    <!-- surfaced sim/transport failures — the boundary never wedges quietly -->
    <div v-if="simError" class="sim-error" role="alert" aria-live="assertive">
      <span class="se-msg">{{ simError }}</span>
      <button class="se-btn" type="button" @click="reloadApp">RELOAD</button>
      <button class="se-btn se-dim" type="button" @click="dismissSimError">DISMISS</button>
    </div>

    <div v-if="bootFailure" class="boot-failure" role="alert" aria-live="assertive">
      <div class="bf-mark" aria-hidden="true">◇</div>
      <h1>GRAPHICS LINK OFFLINE</h1>
      <p>{{ bootFailure.message }}</p>
      <code>{{ bootFailure.detail }}</code>
      <div class="bf-actions">
        <button type="button" :disabled="bootRetrying" @click="startLocal">
          {{ bootRetrying ? "RETRYING…" : "RETRY" }}
        </button>
        <button type="button" @click="reloadApp">RELOAD PAGE</button>
      </div>
    </div>

    <div class="hud" :class="{ 'hud--phone': phoneGuest }" v-if="ready && !startScreen">
      <VitalsStrip v-if="phoneGuest" class="phone-vitals" />
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
        <AlienTechStatus />
        <Alerts />
        <TradePrompt v-if="capabilities.canRespondTrade" />
        <LaunchPrompt v-if="capabilities.canManageColonies" />
        <ColoniesMap v-if="capabilities.canManageColonies" />
        <Lobby @host="onHost" @join="onJoin" />
      </div>

      <NarratorTicker />
      <LogOverlay />

      <div class="bottom-center">
        <PilotBar />
        <Inspector />
        <!-- guests are astronauts, never architects → no build palette -->
        <Palette v-if="capabilities.canBuild && !piloting" />
      </div>

    </div>

    <!-- FirstHint/HintToast teach architect controls — suppressed in the phone cockpit -->
    <div v-if="!booting && !startScreen && !phoneGuest" class="hint-layer">
      <FirstHint />
      <HintToast />
    </div>

    <EndScreen v-if="!booting" />

    <StartScreen v-if="!booting && startScreen" />

    <SettingsModal />

    <HelpModal />

    <AwayDigest v-if="!booting" />

    <Curtain />

    <Boot v-if="booting" @done="booting = false" />

    <ViewportGate v-if="!booting" @join="onJoin" />
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
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-height: calc(100dvh - 136px);
}

/* the failure banner — top-center, above everything, deliberately plain */
.sim-error {
  position: absolute;
  top: 44px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 90;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(620px, 92vw);
  padding: 9px 12px;
  font-family: var(--mono);
  font-size: 10.5px;
  line-height: 1.45;
  color: #f0c9c0;
  background: rgba(40, 14, 10, 0.88);
  border: 1px solid rgba(224, 122, 95, 0.55);
  border-radius: 4px;
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
}
.se-btn {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  padding: 4px 9px;
  border-radius: 3px;
  color: #f0c9c0;
  border: 1px solid rgba(224, 122, 95, 0.55);
  background: rgba(224, 122, 95, 0.1);
  white-space: nowrap;
}
.se-btn:hover { background: rgba(224, 122, 95, 0.22); }
.se-dim { opacity: 0.7; }

.boot-failure {
  position: absolute;
  inset: 0;
  z-index: 100;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  color: var(--ink);
  background: radial-gradient(120% 100% at 50% 40%, #11171b, #050607);
  font-family: var(--mono);
}
.bf-mark { margin-bottom: 14px; color: var(--crit); font-size: 30px; }
.boot-failure h1 { margin: 0 0 12px; color: #f0c9c0; font-size: 15px; font-weight: 500; letter-spacing: 0.2em; }
.boot-failure p { max-width: 560px; margin: 0 0 12px; font-family: var(--serif); font-size: 16px; font-style: italic; line-height: 1.5; }
.boot-failure code { max-width: min(620px, 92vw); color: var(--dim); font-size: 10px; overflow-wrap: anywhere; }
.bf-actions { display: flex; gap: 9px; margin-top: 22px; }
.bf-actions button { min-height: 38px; padding: 8px 14px; color: #f0c9c0; border: 1px solid rgba(232, 120, 79, 0.5); border-radius: 3px; font-size: 10px; letter-spacing: 0.12em; }
.bf-actions button:hover:not(:disabled) { background: rgba(232, 120, 79, 0.12); }
.bf-actions button:disabled { opacity: 0.5; cursor: wait; }

@media (max-width: 760px) {
  .hint-layer { top: 54px; width: calc(100vw - 20px); max-height: calc(100dvh - 104px); }
  .sim-error { top: 52px; flex-wrap: wrap; }
  .se-msg { flex: 1 0 100%; }
}
</style>
