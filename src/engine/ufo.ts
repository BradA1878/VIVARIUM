/* ============================================================================
   The evil UFO — a rare hostile abductor (doc §0 wall). Modeled on the alien
   trader: a visitor with an inbound → hovering → leaving lifecycle, scheduled on
   the SEPARATE env-rng so the main hazard/arrival stream stays byte-identical.
   Unlike the trader it acts autonomously — at the abduction beat it removes a
   colonist (population -= 1, permanent), unless the colony's Deflector shield
   blocks the grab. Pure: all randomness comes from the passed env-rng. (doc §0)
   ============================================================================ */
import type { UfoView } from "@shared/types";
import type { ColonyState, UfoInstance } from "./state";
import { buildingFunctional, isPiloted, removePilot } from "./state";
import type { Emit } from "./tick";
import type { RNG } from "./rng";
import { techDeflectorBoost } from "./techs";
import { bumpMorale } from "./morale";
import {
  DEFLECTOR_BLOCK, MORALE_BUMP, UFO_GAP_MIN, UFO_GAP_SPAN, UFO_RETRY,
  UFO_INBOUND, UFO_HOVER, UFO_LEAVE, UFO_MIN_SOL, UFO_MIN_POP,
  difficultyProfile,
} from "./tuning";

const DEFLECTOR_ID = "deflector";
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** probability [0,1) that an abduction is blocked. Each ONLINE + functional
 *  Deflector Array has a per-unit block chance (base + Aegis tech); multiple
 *  stack with diminishing returns: 1 − Π(1 − perDeflector). No deflector → 0. */
export function abductionBlockChance(s: ColonyState): number {
  const per = clamp01(DEFLECTOR_BLOCK + techDeflectorBoost(s));
  let through = 1; // probability the grab gets past every deflector
  for (const b of s.buildings) {
    if (b.defId !== DEFLECTOR_ID) continue;
    if (!b.online || !buildingFunctional(b)) continue;
    through *= 1 - per;
  }
  return 1 - through;
}

/** can a UFO appear right now? Past the early game, a real settlement to raid,
 *  and at least one colonist that isn't the one the player is piloting. */
function ufoEligible(s: ColonyState): boolean {
  return s.sol >= UFO_MIN_SOL
    && s.population > UFO_MIN_POP
    && s.colonists.some((c) => !isPiloted(s, c.id));
}

/** spawn a UFO in its inbound phase, locking onto a random non-possessed colonist */
function spawnUfo(s: ColonyState, rng: RNG, emit: Emit): void {
  const targets = s.colonists.filter((c) => !isPiloted(s, c.id));
  if (!targets.length) return;
  const victim = targets[Math.floor(rng.next() * targets.length)];
  s.ufo = {
    id: s.ufoCounter++, phase: "inbound", tLeft: UFO_INBOUND,
    targetId: victim.id, gx: Math.round(victim.x), gy: Math.round(victim.y),
  };
  emit({ type: "ufo_inbound" });
}

/** the abduction beat: take the locked colonist unless it vanished, the colony is
 *  at the population floor, or the Deflector shield wins the roll. Consumes one
 *  env-rng draw only when a real attempt is made. */
function resolveAbduction(s: ColonyState, u: UfoInstance, rng: RNG, emit: Emit): void {
  const victim = u.targetId != null ? s.colonists.find((c) => c.id === u.targetId) : undefined;
  if (!victim) return;                      // target gone — it leaves empty-handed
  if (s.population <= UFO_MIN_POP) return;   // floor — never the last few
  if (rng.next() < abductionBlockChance(s)) { emit({ type: "abduction_blocked" }); return; }
  s.colonists = s.colonists.filter((c) => c.id !== victim.id);
  removePilot(s, victim.id); // safety; we never target a piloted colonist
  s.population = Math.max(0, s.population - 1);
  emit({ type: "abducted" });
  bumpMorale(s, -MORALE_BUMP.abducted);
}

/** the tick's UFO pass — schedule a visit, advance its lifecycle, abduct. Runs on
 *  the env-rng (like deposits + traders), so the main hazard/arrival stream is
 *  untouched. Autonomous: the abduction's consequence is real and deterministic. */
export function updateUfo(s: ColonyState, dt: number, rng: RNG, emit: Emit): void {
  if (!s.ufo) {
    s.nextUfo -= dt;
    if (s.nextUfo <= 0) {
      if (ufoEligible(s)) {
        spawnUfo(s, rng, emit);
        // gap mult applies after the draw — same draw count on every difficulty
        s.nextUfo = (UFO_GAP_MIN + rng.next() * UFO_GAP_SPAN)
          * difficultyProfile(s.difficulty).ufoGapMult;
      } else {
        s.nextUfo = UFO_RETRY;
      }
    }
    return;
  }

  const u = s.ufo;
  // track the victim so the beam follows them (the renderer reads targetId + gx/gy)
  const target = u.targetId != null ? s.colonists.find((c) => c.id === u.targetId) : undefined;
  if (target) { u.gx = Math.round(target.x); u.gy = Math.round(target.y); }
  else u.targetId = null;

  u.tLeft -= dt;
  if (u.tLeft > 0) return;

  if (u.phase === "inbound") {
    u.phase = "hovering"; u.tLeft = UFO_HOVER;
  } else if (u.phase === "hovering") {
    resolveAbduction(s, u, rng, emit);
    u.phase = "leaving"; u.tLeft = UFO_LEAVE;
  } else {
    s.ufo = null;
    emit({ type: "ufo_left" });
  }
}

/** serializable view of the live UFO, or null */
export function ufoView(s: ColonyState): UfoView | null {
  const u = s.ufo;
  if (!u) return null;
  return { id: u.id, phase: u.phase, targetId: u.targetId, gx: u.gx, gy: u.gy };
}
