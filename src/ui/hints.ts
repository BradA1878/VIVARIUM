/* ============================================================================
   Contextual hints — one-shot teaching toasts, each tied to the first moment a
   mechanic actually matters (the brownout that just hit, the traders on
   approach, the hab sitting dark with no corridor). The PURE derivations and the
   queue live here so vitest can reach them; HintToast.vue only renders.

   Rules: one toast at a time; a hint is marked seen AT SHOW TIME (a blocked or
   suppressed hint is not burned and may fire later); everything is suppressed
   while the FirstHint welcome card (key "vivarium:hinted:v1") is still unseen —
   the player is reading the big card, not the margins.

   Storage is injectable with try/catch around every access (the settings /
   memory.ts loadModel pattern); nothing touches window at import time.
   ============================================================================ */
import type { ColonyEvent, Snapshot } from "@shared/types";
import { DEFS } from "@/engine/defs";

export type HintId = "corridor" | "brownout" | "trade" | "deflector" | "mining";

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
    default: return null;
  }
}

/** the per-run scratch state behind the snapshot-derived hints */
export interface HintScratch {
  /** sim-time a pressure building was first seen unconnected, or null if none is */
  unconnectedSince: number | null;
  /** a possession has been observed already (the mining hint is a first-time thing) */
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

  // mining — the first time the player steps into a colonist
  if (s.possessed != null && !scratch.possessedOnce) {
    scratch.possessedOnce = true;
    return "mining";
  }

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

/** one toast at a time; seen is marked (and persisted) only when a hint shows */
export class Hints {
  readonly scratch: HintScratch = freshScratch();
  private seen: Set<HintId>;
  private active: HintId | null = null;
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

  /** offer a candidate; returns the Hint to show now, or null (blocked hints are not burned) */
  private offer(id: HintId | null): Hint | null {
    if (!id || this.active != null || this.suppressed() || this.seen.has(id)) return null;
    this.seen.add(id); // seen AT SHOW TIME — one-shot from here on
    saveSeen(this.seen, this.storage);
    this.active = id;
    return HINTS[id];
  }

  onEvent(e: ColonyEvent): Hint | null {
    return this.offer(hintForEvent(e));
  }

  onSnapshot(s: Snapshot): Hint | null {
    return this.offer(hintForSnapshot(s, this.scratch));
  }

  /** the toast was closed (or timed out) — the next hint may show */
  dismiss(): void {
    this.active = null;
  }
}
