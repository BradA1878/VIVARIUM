/* ============================================================================
   The colony store — the single reactive contract every HUD component reads.
   It wraps SimBridge (the worker) and the renderer's tool controls. The HUD only
   ever observes the snapshot/event stream and issues commands (doc §0); it never
   touches the tick.
   ============================================================================ */
import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import type { ColonyEvent, Snapshot } from "@shared/types";
import type { SimBridge } from "@/worker/bridge";
import type { ThreeRenderer } from "@/render/renderer";
import type { HoverInfo } from "@/render/three/placement";
import { ScriptedNarrator } from "@/agent/narrator";
import { clockOf } from "../format";

export interface TerminalLine {
  id: number;
  text: string;
  sol: number;
  clock: string;
}

// ---- module-singleton reactive state ----------------------------------------
const snapshot: ShallowRef<Snapshot | null> = shallowRef(null);
const messages: Ref<TerminalLine[]> = ref([]);
const tool: Ref<string | null> = ref(null);
const demolish = ref(false);
const hover: Ref<HoverInfo | null> = ref(null);

let bridge: SimBridge | null = null;
let renderer: ThreeRenderer | null = null;
let narrator: ScriptedNarrator | null = null;
let msgId = 1;

/** push a line into VIVARIUM's terminal (used by the narrator, Phase 7) */
export function pushLine(text: string): void {
  const s = snapshot.value;
  messages.value = [
    ...messages.value,
    { id: msgId++, text, sol: s ? s.sol : 1, clock: clockOf(s ? s.tod : 0) },
  ].slice(-40);
}

/** wire the store to the live bridge + renderer (called once from App) */
export function initColony(b: SimBridge, r: ThreeRenderer): void {
  bridge = b;
  renderer = r;
  narrator = new ScriptedNarrator();
  b.onSnapshot((s) => { snapshot.value = s; });
  r.onHover((info) => { hover.value = info; });

  // the agent layer observes the event stream — VIVARIUM speaks (doc §0, §3.1).
  // It uses the event's own sim-time as the gate clock, so cooldowns are stable.
  b.onEvent((e) => {
    const line = narrator?.observe(e, e.t);
    if (line) pushLine(line);
  });

  // first words
  setTimeout(() => { if (narrator) pushLine(narrator.bootLine()); }, 900);
}

// ---- tool selection (mirrors prototype app.jsx) ------------------------------
function pick(defId: string): void {
  if (tool.value === defId && !demolish.value) { clearTool(); return; }
  tool.value = defId;
  demolish.value = false;
  renderer?.setTool(defId);
}
function toggleDemolish(): void {
  const v = !demolish.value;
  demolish.value = v;
  tool.value = null;
  if (v) renderer?.setDemolish();
  else renderer?.clearTool();
}
function clearTool(): void {
  tool.value = null;
  demolish.value = false;
  renderer?.clearTool();
}

// ---- controls ----------------------------------------------------------------
const controls = {
  togglePause(): void { if (bridge && snapshot.value) bridge.setPaused(!snapshot.value.paused); },
  setSpeed(n: number): void { bridge?.setPaused(false); bridge?.setSpeed(n); },
  storm(): void { bridge?.forceStorm(); },
  reset(): void {
    bridge?.reset();
    narrator?.reset();
    messages.value = [];
    clearTool();
    // re-greet after the colony reseeds
    setTimeout(() => { if (narrator) pushLine(narrator.bootLine()); }, 600);
  },
  save(): Promise<unknown> | undefined { return bridge?.save(); },
};

/** the bridge's event stream, for the narrator to subscribe to (Phase 7) */
export function onColonyEvent(fn: (e: ColonyEvent) => void): () => void {
  return bridge ? bridge.onEvent(fn) : () => {};
}

export function useColony() {
  return { snapshot, messages, tool, demolish, hover, pick, toggleDemolish, clearTool, controls };
}
