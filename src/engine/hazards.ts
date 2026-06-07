/* ============================================================================
   The hazard system — the planet's repertoire (doc evolved: a living environment).
   Hazards have a lifecycle (telegraph → active), an intensity, a duration, and
   mechanical effects applied in the tick. A seeded scheduler runs them so the
   engine stays standalone + deterministic; when a Director is attached it stands
   down and hazards arrive only via triggerHazard. Pure: all randomness comes from
   the passed RNG (no Math.random / Date / async — engine determinism, doc §0).
   ============================================================================ */
import type { ColonyEvent, HazardKind, HazardView } from "@shared/types";
import { DEFS } from "./defs";
import { idx, removeBuilding } from "./grid";
import { recomputeCaps } from "./caps";
import type { ColonyState, HazardInstance } from "./state";
import type { BuildingState } from "@shared/types";
import type { RNG } from "./rng";

type Emit = (e: Omit<ColonyEvent, "t" | "sol" | "tod">) => void;

interface KindMeta {
  warn: number;        // telegraph seconds
  activeMin: number;
  activeSpan: number;
  intMin: number;
  intSpan: number;
  cadence?: number;    // base seconds between strikes/jolts (meteor/quake)
  weight: number;      // scheduler pick weight
}

export const HAZARD_META: Record<HazardKind, KindMeta> = {
  dust:     { warn: 6, activeMin: 26, activeSpan: 16, intMin: 0.7, intSpan: 0.3, weight: 4 },
  meteor:   { warn: 5, activeMin: 12, activeSpan: 8,  intMin: 0.4, intSpan: 0.5, cadence: 1.3, weight: 2 },
  flare:    { warn: 8, activeMin: 14, activeSpan: 10, intMin: 0.4, intSpan: 0.5, weight: 2 },
  coldsnap: { warn: 6, activeMin: 28, activeSpan: 18, intMin: 0.4, intSpan: 0.5, weight: 2 },
  quake:    { warn: 4, activeMin: 8,  activeSpan: 6,  intMin: 0.4, intSpan: 0.5, cadence: 1.6, weight: 1 },
};

export const SCHED_FIRST = 95;
const SCHED_GAP_MIN = 70, SCHED_GAP_SPAN = 70;

// damage / effect tuning
const METEOR_DMG = 0.55;
const QUAKE_DMG = 0.4;
export const FUNC_THRESHOLD = 0.45; // below this integrity → non-functional
const REPAIR_RATE = 0.02;           // integrity/sec self-repair
const FLARE_DRAIN = 6;              // power/sec siphon at full intensity
const FLARE_FAULT_CHANCE = 0.3;     // per-sec at full intensity
const FLARE_FAULT_SECS = 5;
const COLDSNAP_HEAT = 1.6;          // pressurized power draw ×… at full intensity

const ORDER: HazardKind[] = ["dust", "meteor", "flare", "coldsnap", "quake"];

/** spawn a hazard in its telegraph phase; returns the chosen intensity */
export function spawnHazard(s: ColonyState, kind: HazardKind, rng: RNG, intensity?: number): number {
  const m = HAZARD_META[kind];
  const inten = clamp01(intensity ?? m.intMin + rng.next() * m.intSpan);
  s.hazards.push({
    kind, phase: "telegraph", tLeft: m.warn,
    activeDur: m.activeMin + rng.next() * m.activeSpan,
    intensity: inten, cadence: m.cadence ?? 0,
  });
  return inten;
}

function pickKind(rng: RNG): HazardKind {
  const total = ORDER.reduce((a, k) => a + HAZARD_META[k].weight, 0);
  let r = rng.next() * total;
  for (const k of ORDER) { r -= HAZARD_META[k].weight; if (r <= 0) return k; }
  return "dust";
}

/** advance scheduler + lifecycle + active effects; derive weather; self-repair */
export function updateHazards(s: ColonyState, dt: number, rng: RNG, emit: Emit): void {
  if (!s.directorControlled) {
    s.nextHazard -= dt;
    if (s.nextHazard <= 0) {
      const kind = pickKind(rng);
      spawnHazard(s, kind, rng);
      emit({ type: "hazard_warn", kind, detail: kind, secs: Math.round(HAZARD_META[kind].warn) });
      s.nextHazard = SCHED_GAP_MIN + rng.next() * SCHED_GAP_SPAN;
    }
  }

  const keep: HazardInstance[] = [];
  for (const h of s.hazards) {
    h.tLeft -= dt;
    if (h.phase === "telegraph") {
      if (h.tLeft <= 0) { h.phase = "active"; h.tLeft = h.activeDur; emit({ type: "hazard_start", kind: h.kind, detail: h.kind }); }
      keep.push(h);
      continue;
    }
    applyActive(s, h, dt, rng, emit);
    if (h.tLeft <= 0) emit({ type: "hazard_end", kind: h.kind, detail: h.kind });
    else keep.push(h);
  }
  s.hazards = keep;

  s.weather = s.hazards.some((h) => h.kind === "dust" && h.phase === "active") ? "dust" : "clear";

  // self-repair + electronics fault decay
  for (const b of s.buildings) {
    if (b.faulted > 0) b.faulted = Math.max(0, b.faulted - dt);
    if (b.integrity < 1) b.integrity = Math.min(1, b.integrity + REPAIR_RATE * dt);
  }
}

function applyActive(s: ColonyState, h: HazardInstance, dt: number, rng: RNG, emit: Emit): void {
  switch (h.kind) {
    case "dust":
    case "coldsnap":
      return; // passive — see hazardMods()
    case "flare":
      if (rng.next() < FLARE_FAULT_CHANCE * h.intensity * dt) {
        const targets = s.buildings.filter((b) => (DEFS[b.defId]?.consumes.power ?? 0) > 0 && b.faulted <= 0 && b.integrity > 0);
        if (targets.length) {
          const b = targets[(rng.next() * targets.length) | 0];
          b.faulted = FLARE_FAULT_SECS;
          emit({ type: "building_damaged", defId: b.defId, gx: b.gx, gy: b.gy, detail: "flare" });
        }
      }
      return;
    case "meteor":
      h.cadence -= dt;
      if (h.cadence <= 0) {
        h.cadence = HAZARD_META.meteor.cadence! * (1.4 - h.intensity);
        strikeCell(s, rng, emit, METEOR_DMG * (0.6 + h.intensity), "meteor");
      }
      return;
    case "quake":
      h.cadence -= dt;
      if (h.cadence <= 0) {
        h.cadence = HAZARD_META.quake.cadence! * (1.4 - h.intensity);
        // quakes target infrastructure — corridors + sealed units (break the seal)
        strikeTarget(s, rng, emit, QUAKE_DMG * (0.6 + h.intensity), "quake",
          (b) => { const d = DEFS[b.defId]; return !!d && (d.conduit === true || d.requiresPressure === true); });
      }
      return;
  }
}

/** a strike at a random cell — damages a building if one is there */
function strikeCell(s: ColonyState, rng: RNG, emit: Emit, dmg: number, cause: HazardKind): void {
  const x = (rng.next() * s.N) | 0, y = (rng.next() * s.N) | 0;
  const id = s.grid[idx(s.N, x, y)];
  if (id !== 0) {
    const b = s.buildings.find((bb) => bb.uid === id);
    if (b) { damageBuilding(s, b, dmg, emit, cause); emit({ type: "strike", gx: x, gy: y, hit: true, detail: cause }); return; }
  }
  emit({ type: "strike", gx: x, gy: y, hit: false, detail: cause });
}

/** a strike aimed at a filtered building (quakes hit infrastructure) */
function strikeTarget(s: ColonyState, rng: RNG, emit: Emit, dmg: number, cause: HazardKind, filter: (b: BuildingState) => boolean): void {
  const targets = s.buildings.filter(filter);
  if (!targets.length) return;
  const b = targets[(rng.next() * targets.length) | 0];
  damageBuilding(s, b, dmg, emit, cause);
  emit({ type: "strike", gx: b.gx, gy: b.gy, hit: true, detail: cause });
}

export function damageBuilding(s: ColonyState, b: BuildingState, amount: number, emit: Emit, cause: string): void {
  b.integrity = Math.max(0, b.integrity - amount);
  emit({ type: "building_damaged", defId: b.defId, gx: b.gx, gy: b.gy, detail: cause });
  if (b.integrity <= 0) {
    removeBuilding(s, b.uid);
    recomputeCaps(s);
    emit({ type: "building_destroyed", defId: b.defId, gx: b.gx, gy: b.gy, detail: cause });
  }
}

export interface HazardMods {
  /** multiply solar generation (dust gutting) */
  solarFactor: number;
  /** multiply pressurized buildings' power draw (cold-snap heating) */
  pressurePowerMult: number;
  /** flat power siphon per second (solar flare) */
  powerDrain: number;
}

export function hazardMods(s: ColonyState): HazardMods {
  let solarFactor = 1, pressurePowerMult = 1, powerDrain = 0;
  for (const h of s.hazards) {
    if (h.phase !== "active") continue;
    if (h.kind === "dust") solarFactor = Math.min(solarFactor, 1 - 0.88 * h.intensity);
    else if (h.kind === "coldsnap") pressurePowerMult *= 1 + (COLDSNAP_HEAT - 1) * h.intensity;
    else if (h.kind === "flare") powerDrain += FLARE_DRAIN * h.intensity;
  }
  return { solarFactor, pressurePowerMult, powerDrain };
}

/** can this building operate? (intact + not faulted) */
export function buildingFunctional(b: BuildingState): boolean {
  return b.integrity >= FUNC_THRESHOLD && b.faulted <= 0;
}

export function hazardViews(s: ColonyState): HazardView[] {
  return s.hazards.map((h) => ({ kind: h.kind, phase: h.phase, intensity: h.intensity, remaining: h.tLeft }));
}

function clamp01(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : n; }
