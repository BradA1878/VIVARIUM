/* ============================================================================
   The rover — rung 2 of the automation ladder (homeostasis update). A drivable
   bulk hauler: fabricated by the Rover Bay on a colony countdown, possessed
   through the SAME protocol as a colonist because its id draws from
   s.colonistCounter (every possessable id is globally unique, so `possess {id}`
   needs no new command). Zero RNG anywhere — fabrication is a timer, driving
   integrates the player's moveIntent, and damage falls out of the existing
   strike cells — so the main hazard/arrival rng stream stays byte-identical
   (doc §0 wall). The cargo mechanics live with their siblings in gather.ts.
   ============================================================================ */
import type { RoverView } from "@shared/types";
import type { ColonyState, Pilot, RoverInstance } from "./state";
import { buildingFunctional, FUNC_THRESHOLD, isPiloted } from "./state";
import type { Emit } from "./tick";
import {
  ROVER_BUILD_TIME, ROVER_CAP, ROVER_HIT_RADIUS, ROVER_REPAIR_RATE,
  ROVER_SPEED, ROVER_STRIKE_DMG,
} from "./tuning";
import { accessCell, freeCellNear } from "./colonists";
import { cargoTotal } from "./gather";
import { destroyRobotsNear } from "./robots";

const BAY_ID = "roverbay";

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** the Rover Bay's fabrication line + the fleet's slow self-repair. The
 *  countdown runs only while some bay is online && functional and the fleet is
 *  under ROVER_CAP — a dark bay PAUSES it where it stopped (never resets). At
 *  zero the rover rolls out onto a free cell by the bay's door with integrity
 *  1, drawing its id from the colonist counter (the unified possessable id
 *  space), and rover_ready fires. */
export function updateRoverFab(s: ColonyState, dt: number, emit: Emit): void {
  // self-repair toward 1 — strikes dent the fleet; time straightens the panels
  for (const r of s.rovers) {
    if (r.integrity < 1) r.integrity = Math.min(1, r.integrity + ROVER_REPAIR_RATE * dt);
  }
  if (s.rovers.length >= ROVER_CAP) return;
  const bay = s.buildings.find((b) => b.defId === BAY_ID && b.online && buildingFunctional(b));
  if (!bay) return; // no working bay → the countdown holds
  s.roverFab -= dt;
  if (s.roverFab > 0) return;
  s.roverFab = ROVER_BUILD_TIME;
  const at = freeCellNear(s, accessCell(s, bay));
  const rover: RoverInstance = {
    id: s.colonistCounter++, x: at.x, y: at.y, facing: 0, cargo: {}, integrity: 1,
  };
  s.rovers.push(rover);
  emit({ type: "rover_ready", defId: BAY_ID, gx: Math.round(at.x), gy: Math.round(at.y) });
}

/** the possessed rover: integrate the standing moveIntent at ROVER_SPEED.
 *  Too dented to function (integrity < FUNC_THRESHOLD) → immobile until
 *  self-repair crosses back over the line. */
export function pilotRover(s: ColonyState, r: RoverInstance, p: Pilot, dt: number): void {
  if (r.integrity < FUNC_THRESHOLD) return;
  const { dx, dy } = p;
  const m = Math.hypot(dx, dy);
  if (m > 0.0001) {
    r.x = clamp(r.x + (dx / m) * ROVER_SPEED * dt, 0, s.N - 1);
    r.y = clamp(r.y + (dy / m) * ROVER_SPEED * dt, 0, s.N - 1);
    r.facing = Math.atan2(dx, dy);
  }
}

/** a meteor/quake strike at (gx,gy) hits the machines near the impact. Rovers
 *  take a flat ROVER_STRIKE_DMG off integrity, clamped at 0 — a rover is NEVER
 *  destroyed (a big purchase must not evaporate); it limps below FUNC_THRESHOLD
 *  until self-repair restores it. Robots inside ROBOT_HIT_RADIUS are scrapped
 *  outright (the cheap, replaceable rung — engine/robots.ts). Runs beside
 *  applyStrikeInjuries on every strike path (hazards.ts). Guarded for minimal
 *  test states. */
export function applyStrikeMachines(s: ColonyState, gx: number, gy: number, emit: Emit): void {
  for (const r of s.rovers ?? []) {
    if (Math.hypot(r.x - gx, r.y - gy) > ROVER_HIT_RADIUS) continue;
    r.integrity = Math.max(0, r.integrity - ROVER_STRIKE_DMG);
  }
  destroyRobotsNear(s, gx, gy, emit);
}

/** snapshot view — cargoTotal precomputed so the HUD/renderer never re-derives */
export function roverViews(s: ColonyState): RoverView[] {
  return s.rovers.map((r) => ({
    id: r.id, x: r.x, y: r.y, facing: r.facing,
    cargo: { ...r.cargo }, cargoTotal: cargoTotal(r.cargo),
    integrity: r.integrity, possessed: isPiloted(s, r.id),
  }));
}
