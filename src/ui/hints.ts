/* ============================================================================
   Contextual hints — one-shot teaching toasts, each tied to the first moment a
   mechanic actually matters (the brownout that just hit, the traders on
   approach, the hab sitting dark with no corridor). The PURE derivations and the
   queue live here so vitest can reach them; HintToast.vue only renders.

   Rules: one toast at a time; a hint is marked seen AT SHOW TIME (a blocked or
   suppressed hint is not burned and may fire later); everything is suppressed
   while the FirstHint welcome card (key "vivarium:hinted:v1") is still unseen —
   the player is reading the big card, not the margins. unlock_* hints are the
   one exception to silent dropping: their events fire ONCE per run, so a
   schematic blocked by an occupied slot waits in a small session-local FIFO
   and shows on the first pump after the slot frees (the store frees it only
   after its inter-toast gap, so the gap is honored for queued cards too).
   Caveat: SUPPRESSED unlock candidates (welcome card unseen) still drop before
   reaching the FIFO — on a first run the chime / narrator line / palette tile
   carry the announcement, and the toast resurfaces on a later run since seen
   only marks at show time.

   Storage is injectable with try/catch around every access (the settings /
   memory.ts loadModel pattern); nothing touches window at import time.
   ============================================================================ */
import type { ColonyEvent, Snapshot } from "@shared/types";
import { DEFS } from "@/engine/defs";

export type HintId =
  | "corridor" | "brownout" | "trade" | "deflector" | "mining"
  // schematic toasts — one per gated def, keyed "unlock_" + defId so the
  // unlock event maps mechanically (and stays one-shot via the seen-set)
  | "unlock_windturbine" | "unlock_geothermal" | "unlock_reactor"
  | "unlock_printer" | "unlock_roverbay" | "unlock_roboticsbay";

export interface Hint {
  id: HintId;
  title: string;
  body: string;
}

/** short, plain-language cards in the FirstHint tone */
export const HINTS: Record<HintId, Hint> = {
  corridor: {
    id: "corridor",
    title: "NO PRESSURE",
    body: "A sealed building only runs once a corridor links it to the hub. Pick the corridor tile, click the dark building, then click the hub — the route finds itself.",
  },
  brownout: {
    id: "brownout",
    title: "BROWNOUT",
    body: "Demand outran the grid, and the lowest-priority buildings went dark first. More solar carries the day; batteries carry the night.",
  },
  trade: {
    id: "trade",
    title: "TRADERS INBOUND",
    body: "An alien crew wants to barter. When they land, weigh what they take against what they give — waving them off is always safe.",
  },
  deflector: {
    id: "deflector",
    title: "ABDUCTORS OVERHEAD",
    body: "That ship is here for your people. A powered Deflector Array turns its beam away — build one, and keep it lit through brownouts.",
  },
  mining: {
    id: "mining",
    title: "YOU ARE THE COLONIST",
    body: "Walk with the Arrow keys or WASD. Press P on a glowing deposit to mine it, carry the load to the depot hopper, and press F to step back out.",
  },
  unlock_windturbine: {
    id: "unlock_windturbine",
    title: "NEW SCHEMATIC: WIND TURBINE",
    body: "Power from moving air — strongest at night and through dust, exactly when the panels go dark.",
  },
  unlock_geothermal: {
    id: "unlock_geothermal",
    title: "NEW SCHEMATIC: GEOTHERMAL TAP",
    body: "Flat power, sol and night — but it only seats on a vent. Pick the tool and the fumaroles light up.",
  },
  unlock_reactor: {
    id: "unlock_reactor",
    title: "NEW SCHEMATIC: FISSION REACTOR",
    body: "Big, steady power that sips water and wants an engineer on the rods. The grid stops being a worry.",
  },
  unlock_printer: {
    id: "unlock_printer",
    title: "NEW SCHEMATIC: MATERIALS PRINTER",
    body: "Regolith in, materials out — a slow trickle of build currency that frees your people from the ore field.",
  },
  unlock_roverbay: {
    id: "unlock_roverbay",
    title: "NEW SCHEMATIC: ROVER BAY",
    body: "The garage fabricates a drivable bulk hauler. When it rolls out, press F to take the wheel.",
  },
  unlock_roboticsbay: {
    id: "unlock_roboticsbay",
    title: "NEW SCHEMATIC: ROBOTICS BAY",
    body: "Prints autonomous mining robots that work the deposit field sol and night, no air required.",
  },
};

export type HintStorage = Pick<Storage, "getItem" | "setItem">;

/** the seen-set of hints already shown (one-shot, forever) */
export const HINTS_SEEN_KEY = "vivarium:hints:v1";
/** FirstHint.vue's dismissal key — hints stay quiet until the welcome card is read */
export const FIRST_HINT_KEY = "vivarium:hinted:v1";

/** how long a pressure building must sit unconnected before the corridor hint */
const CORRIDOR_DEBOUNCE_S = 5;

// ---- pure derivations -----------------------------------------------------------

/** events that ARE teaching moments — the hint names the mechanic that answers them */
export function hintForEvent(e: ColonyEvent): HintId | null {
  switch (e.type) {
    case "brownout": return "brownout";
    case "traders_inbound": return "trade";
    case "ufo_inbound": return "deflector";
    case "unlock": {
      // one schematic toast per gated def; unknown defs (future gates) stay quiet
      const id = `unlock_${e.defId ?? ""}`;
      return id in HINTS ? (id as HintId) : null;
    }
    default: return null;
  }
}

/** the per-run scratch state behind the snapshot-derived hints */
export interface HintScratch {
  /** sim-time a pressure building was first seen unconnected, or null if none is */
  unconnectedSince: number | null;
  /** the mining hint's one-shot trigger has been consumed — the queue marks this
   *  at SHOW time (or when the hint is already in the forever seen-set), never
   *  on a blocked offer, so a possession under another toast can fire later */
  possessedOnce: boolean;
}

export function freshScratch(): HintScratch {
  return { unconnectedSince: null, possessedOnce: false };
}

export function hintForSnapshot(s: Snapshot, scratch: HintScratch): HintId | null {
  // the corridor clock tracks continuously — debounce against flapping connectivity
  const stranded = s.buildings.some((b) => !!DEFS[b.defId]?.requiresPressure && !b.connected);
  if (!stranded) scratch.unconnectedSince = null;
  else if (scratch.unconnectedSince == null) scratch.unconnectedSince = s.t;

  // mining — the first time the player steps into a colonist. This only
  // PROPOSES: the queue consumes possessedOnce when the hint actually shows,
  // so an offer blocked by an active toast is not burned (the rule up top).
  if (s.possessed != null && !scratch.possessedOnce) return "mining";

  if (scratch.unconnectedSince != null && s.t - scratch.unconnectedSince >= CORRIDOR_DEBOUNCE_S) {
    return "corridor";
  }
  return null;
}

// ---- persistence helpers ----------------------------------------------------------

/** the browser's localStorage when it exists and is reachable, else null (Node) */
function defaultStorage(): HintStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSeen(storage?: HintStorage): Set<HintId> {
  try {
    const st = storage ?? defaultStorage();
    const raw = st?.getItem(HINTS_SEEN_KEY);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is HintId => typeof x === "string" && x in HINTS));
  } catch {
    return new Set(); // corrupt / private mode — hints may repeat, never break
  }
}

export function saveSeen(seen: ReadonlySet<HintId>, storage?: HintStorage): void {
  try {
    const st = storage ?? defaultStorage();
    st?.setItem(HINTS_SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

/** has the FirstHint welcome card been dismissed yet? */
export function firstHintSeen(storage?: HintStorage): boolean {
  try {
    const st = storage ?? defaultStorage();
    return st?.getItem(FIRST_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

// ---- the queue --------------------------------------------------------------------

/** an unlock_* schematic toast — the only hints whose trigger fires once per run */
function isUnlockHint(id: HintId): boolean {
  return id.startsWith("unlock_");
}

/** the pending FIFO's cap — schematics beyond it drop unburned (a later run shows them) */
const PENDING_CAP = 4;

/** one toast at a time; seen is marked (and persisted) only when a hint shows */
export class Hints {
  readonly scratch: HintScratch = freshScratch();
  private seen: Set<HintId>;
  private active: HintId | null = null;
  /** blocked schematic toasts wait here (FIFO) — unlock events fire once per
   *  run, so an occupied slot must not swallow the card. Session-local by
   *  design, never persisted: an unshown queue dies with the tab, and since
   *  seen only marks at show time the card simply fires again on a later run. */
  private pending: HintId[] = [];
  /** caches `firstHintSeen` once true — it never goes back within a session */
  private unlocked = false;
  private readonly storage?: HintStorage;

  constructor(storage?: HintStorage) {
    this.storage = storage;
    this.seen = loadSeen(storage);
  }

  private suppressed(): boolean {
    if (!this.unlocked) this.unlocked = firstHintSeen(this.storage);
    return !this.unlocked;
  }

  /** offer a candidate; returns the Hint to show now, or null. Blocked hints
   *  are not burned; blocked unlock_* candidates queue instead of dropping,
   *  and a freed slot serves the queue (oldest first) before new candidates. */
  private offer(id: HintId | null): Hint | null {
    if (this.suppressed()) return null;
    // a schematic that cannot show RIGHT NOW (slot held, or older schematics
    // already waiting) joins the FIFO — every other hint keeps the drop
    // semantics, because its trigger re-fires naturally
    if (
      id && isUnlockHint(id) && (this.active != null || this.pending.length > 0) &&
      !this.seen.has(id) && !this.pending.includes(id) && this.pending.length < PENDING_CAP
    ) {
      this.pending.push(id);
    }
    if (this.active != null) return null;
    const pick = this.pending.length > 0 ? this.pending.shift()! : id;
    if (!pick || this.seen.has(pick)) return null;
    this.seen.add(pick); // seen AT SHOW TIME — one-shot from here on
    saveSeen(this.seen, this.storage);
    this.active = pick;
    return HINTS[pick];
  }

  onEvent(e: ColonyEvent): Hint | null {
    return this.offer(hintForEvent(e));
  }

  onSnapshot(s: Snapshot): Hint | null {
    const id = hintForSnapshot(s, this.scratch);
    const hint = this.offer(id);
    // consume the one-shot mining trigger only once it actually shows — or when
    // it is already in the forever seen-set (burned for good, and consuming the
    // scratch lets the corridor hint through while still possessed). A blocked
    // offer leaves the trigger intact to fire at the next opportunity this run.
    // NOTE the id match: offer may show a QUEUED schematic on this very pump,
    // which must not count as the mining hint having shown.
    if (id === "mining" && (hint?.id === id || this.seen.has(id))) {
      this.scratch.possessedOnce = true;
    }
    return hint;
  }

  /** the toast was closed (or timed out, or the gap elapsed) — the slot frees,
   *  and the NEXT event/snapshot pump may show a hint (queued schematics first) */
  dismiss(): void {
    this.active = null;
  }
}
