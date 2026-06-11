/* ============================================================================
   Audio map — the PURE half of the sound system, and the unit-test target.
   Three derivations, zero Web Audio:

     event  → cue        EVENT_CUES   (which ColonyEvent earns which sting)
     state  → ambience   deriveState  (wind/hum/dread/rumble bed targets)
     Δstate → cues       diffSnapshot (place/demolish/pickup/drop — transitions
                                       the engine never announces as events)

   The audio engine (index.ts) consumes these; vitest consumes them in plain
   Node. Nothing here may import synth/ambient or touch window/AudioContext.
   ============================================================================ */
import type { ColonyEvent, EventType, Snapshot } from "@shared/types";
import { DAY_START, DAY_END, DEPOT_RADIUS } from "@/engine/tuning";

// ---- cue vocabulary ------------------------------------------------------------

/** every one-shot the synth knows how to play */
export const CUE_IDS = [
  "uiTick", "place", "demolish",
  "alertWarn", "hazardStart", "hazardEnd",
  "brownout", "powerBack", "critPulse", "casualtyDrone",
  "chimeUp", "tradeMotif", "tradeDone",
  "ufoSweep", "abductSting", "deflectZap", "destroyed",
  "resupplyHorn", "victoryTheme", "defeatTheme",
  "pickup", "drop",
  "moraleLow", "moraleUp", "injured", "recovered",
] as const;

export type CueId = (typeof CUE_IDS)[number];

/** per-cue minimum gap between plays (ms) — a burst of identical events (every
 *  hab browning out in one tick) reads as ONE sound, not a machine-gun. The
 *  Record type keeps this exhaustive: a new CueId won't compile without a gap. */
export const CUE_MIN_GAP_MS: Record<CueId, number> = {
  uiTick: 60,
  place: 150,
  demolish: 150,
  pickup: 250,
  drop: 250,
  alertWarn: 2000,
  hazardStart: 1500,
  hazardEnd: 1500,
  brownout: 1200,
  powerBack: 1200,
  critPulse: 1800,
  casualtyDrone: 4000,
  chimeUp: 900,
  tradeMotif: 3000,
  tradeDone: 1000,
  ufoSweep: 3000,
  abductSting: 1500,
  deflectZap: 700,
  destroyed: 600,
  resupplyHorn: 3000,
  victoryTheme: 10000,
  defeatTheme: 10000,
  moraleLow: 4000,
  moraleUp: 4000,
  injured: 1500,
  recovered: 2000,
};

// ---- event → cue ------------------------------------------------------------------

/** which engine events earn a sting. Per-event functions (not bare ids) so a
 *  mapping can inspect the payload; unmapped events simply have no entry.
 *  Place/demolish come from the snapshot diff below; storms speak through
 *  hazard_* + the wind bed; idle banter is council prose, never a sting. */
export const EVENT_CUES: Partial<Record<EventType, (e: ColonyEvent) => CueId | null>> = {
  hazard_warn: () => "alertWarn",
  hazard_start: () => "hazardStart",
  hazard_end: () => "hazardEnd",
  brownout: () => "brownout",
  power_back: () => "powerBack",
  crit_start: () => "critPulse",
  casualty: () => "casualtyDrone",
  hub_online: () => "chimeUp",
  arrival: () => "chimeUp",
  birth: () => "chimeUp",
  resupply: () => "resupplyHorn",
  traders_inbound: () => "tradeMotif",
  trade_done: () => "tradeDone",
  ufo_inbound: () => "ufoSweep",
  abducted: () => "abductSting",
  abduction_blocked: () => "deflectZap",
  building_destroyed: () => "destroyed",
  victory: () => "victoryTheme",
  defeat: () => "defeatTheme",
  morale_low: () => "moraleLow",
  morale_recovered: () => "moraleUp",
  colonist_injured: () => "injured",
  colonist_recovered: () => "recovered",
};

// ---- snapshot → ambient bed targets -----------------------------------------------

export interface AmbientState {
  /** wind-bed intensity 0..1 — clear 0.18 (0.26 at night), storm telegraph
   *  0.45, dust weather 0.7 rising to 1.0 with active-storm intensity */
  wind: number;
  /** an active dust storm — opens the wind filter (400→1400Hz) */
  stormy: boolean;
  /** the possession hum (the player is inside a suit) */
  hum: boolean;
  /** UFO menace: 0.5 while inbound, 1 while hovering with the beam down */
  dread: 0 | 0.5 | 1;
  /** seismic bed gain: 0.15 while a meteor/quake telegraphs, 0.5 while active */
  rumble: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** derive the ambient-bed targets from a snapshot — pure, so the matrix is
 *  unit-testable and the engine can re-apply it after a mid-game unlock */
export function deriveState(s: Snapshot): AmbientState {
  const dustActive = s.hazards.find((h) => h.kind === "dust" && h.phase === "active");
  const dustComing = s.hazards.some((h) => h.kind === "dust" && h.phase === "telegraph");
  const night = s.tod < DAY_START || s.tod >= DAY_END;
  const wind = dustActive
    ? 0.7 + 0.3 * clamp01(dustActive.intensity) // dust weather 0.7 → full storm 1.0
    : dustComing
      ? 0.45 // the wind picks up before the wall arrives
      : night ? 0.26 : 0.18;

  let rumble = 0;
  for (const h of s.hazards) {
    if (h.kind !== "meteor" && h.kind !== "quake") continue;
    rumble = Math.max(rumble, h.phase === "active" ? 0.5 : 0.15);
  }

  const dread: AmbientState["dread"] =
    s.ufo?.phase === "hovering" ? 1 : s.ufo?.phase === "inbound" ? 0.5 : 0;

  const hum = s.possessed != null && s.colonists.some((c) => c.id === s.possessed);

  return { wind, stormy: s.weather === "dust" || !!dustActive, hum, dread, rumble };
}

// ---- snapshot diff → cues ----------------------------------------------------------

/** "gx,gy" — the shared key for matching diffed removals against the engine's
 *  building_destroyed events (which carry a cell, not a uid) */
export function cellKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

/** the slice of a Snapshot the diff layer compares frame-to-frame */
export interface SnapMini {
  /** uid → cell key for every standing building */
  buildings: ReadonlyMap<number, string>;
  /** the piloted colonist's load + position, or null when nobody is possessed */
  possessed: { id: number; carry: number; x: number; y: number } | null;
  depot: { gx: number; gy: number };
}

export function miniOf(s: Snapshot): SnapMini {
  const buildings = new Map<number, string>();
  for (const b of s.buildings) buildings.set(b.uid, cellKey(b.gx, b.gy));
  const p = s.possessed != null ? s.colonists.find((c) => c.id === s.possessed) : undefined;
  return {
    buildings,
    possessed: p ? { id: p.id, carry: p.carryAmt, x: p.x, y: p.y } : null,
    depot: { gx: s.depot.gx, gy: s.depot.gy },
  };
}

/** more than this many buildings appearing/vanishing in ONE diff is a save-load
 *  or reset, not the player clicking — stay silent */
const BULK_MAX = 3;

/** the drop thunk allows a little drift past the engine's exact drop radius —
 *  the colonist keeps walking between the drop tick and the next snapshot */
const DROP_NEAR = DEPOT_RADIUS + 0.75;

/** cues for the transitions the engine never events: placements, demolitions
 *  (the diff is the ONLY demolish source), and the possessed pick-up/drop.
 *  `recentlyDestroyed` is the caller's set of cell keys recently lost to
 *  hazards — those removals already screamed via the `destroyed` sting. */
export function diffSnapshot(
  prev: SnapMini | null,
  next: SnapMini,
  recentlyDestroyed?: ReadonlySet<string>,
): CueId[] {
  if (!prev) return []; // first sight of the colony — boot or save-load
  const cues: CueId[] = [];

  let added = 0;
  for (const uid of next.buildings.keys()) if (!prev.buildings.has(uid)) added++;
  if (added > 0 && added <= BULK_MAX) for (let i = 0; i < added; i++) cues.push("place");

  const removed: string[] = [];
  for (const [uid, cell] of prev.buildings) if (!next.buildings.has(uid)) removed.push(cell);
  if (removed.length > 0 && removed.length <= BULK_MAX) {
    for (const cell of removed) if (!recentlyDestroyed?.has(cell)) cues.push("demolish");
  }

  const p0 = prev.possessed, p1 = next.possessed;
  if (p0 && p1 && p0.id === p1.id) {
    if (p0.carry === 0 && p1.carry > 0) cues.push("pickup");
    else if (p0.carry > 0 && p1.carry === 0) {
      const nearDepot = Math.hypot(p1.x - next.depot.gx, p1.y - next.depot.gy) <= DROP_NEAR;
      if (nearDepot) cues.push("drop"); // far-from-depot vanishes (release/abduction) stay silent
    }
  }

  return cues;
}
