import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  DAYLIGHT_STEP, ENV_BASE, MIN_BAKE_GAP_MS, SUN_STEP_RAD, SkyEnvironment,
  envIntensity, rebakeReason, skyColors, type BakeRecord, type PmremLike, type SkyState,
} from "./environment";
import { WORLD_LOOKS } from "./worldlook";
import type { World } from "@shared/types";

const WORLDS = Object.keys(WORLD_LOOKS) as World[];

/** the sun direction scene.ts derives for a time of day (kept in sync by hand) */
function sunFor(tod: number): { dir: THREE.Vector3; elev: number } {
  const ang = (tod - 0.5) * Math.PI * 2;
  const elev = Math.cos(ang);
  const dir = new THREE.Vector3(Math.sin(ang) * 30 + 6, Math.max(-6, elev * 34) + 6, 18).normalize();
  return { dir, elev };
}

function state(over: Partial<SkyState> = {}): SkyState {
  const { dir, elev } = sunFor(0.5);
  return { world: "mars", daylight: 0.97, dust: false, sunDir: dir, sunElev: elev, ...over };
}

function record(s: SkyState, atMs: number): BakeRecord {
  return { world: s.world, dust: s.dust, daylight: s.daylight, sunElev: s.sunElev, sunDir: s.sunDir.clone(), atMs };
}

const isFinite3 = (c: THREE.Color) => [c.r, c.g, c.b].every(Number.isFinite);

describe("skyColors", () => {
  it("gives every world finite colors across the sol, in clear air and dust", () => {
    for (const world of WORLDS) for (const tod of [0.1, 0.25, 0.3, 0.5, 0.75, 0.9]) for (const dust of [false, true]) {
      const { dir, elev } = sunFor(tod);
      const c = skyColors(state({ world, sunDir: dir, sunElev: elev, dust, daylight: elev > 0 ? 0.9 : 0.07 }));
      expect([c.zenith, c.horizon, c.bounce, c.sun].every(isFinite3)).toBe(true);
    }
  });

  it("has no sun glow once the sun is below the horizon", () => {
    const { dir, elev } = sunFor(0.9);
    const c = skyColors(state({ sunDir: dir, sunElev: elev, daylight: 0.07 }));
    expect([c.sun.r, c.sun.g, c.sun.b]).toEqual([0, 0, 0]);
  });

  it("uses the dust endpoints and a wide glow in a storm", () => {
    const env = WORLD_LOOKS.mars.sky.env;
    const c = skyColors(state({ dust: true, daylight: 1 }));
    expect(c.zenith.r).toBeCloseTo(env.zenith.dust[0] / 255, 5);
    expect(c.horizon.g).toBeCloseTo(env.horizon.dust[1] / 255, 5);
    expect(c.glowPower).toBe(4);
    expect(skyColors(state()).glowPower).toBe(8);
  });

  it("tints a low sun toward the world's low-sun glow (Mars: bluer near the horizon)", () => {
    const low = skyColors(state({ sunElev: 0.08 }));
    const high = skyColors(state({ sunElev: 1 }));
    const blueShare = (c: THREE.Color) => c.b / (c.r + c.g + c.b);
    expect(blueShare(low.sun)).toBeGreaterThan(blueShare(high.sun));
  });
});

describe("rebakeReason", () => {
  const base = state();
  it("bakes first, then on world or weather changes regardless of the rate limit", () => {
    expect(rebakeReason(null, base, 0)).toBe("first");
    const prev = record(base, 1000);
    expect(rebakeReason(prev, { ...base, world: "ceres" }, 1001)).toBe("world");
    expect(rebakeReason(prev, { ...base, dust: true }, 1001)).toBe("weather");
  });

  it("re-bakes for a sun move past the step, but not inside the rate limit", () => {
    const prev = record(base, 1000);
    // rotate about an axis perpendicular to the sun so the rotation angle IS the
    // angle the sun moves (a high sun barely moves under a rotation about +Y)
    const perp = new THREE.Vector3().crossVectors(base.sunDir, new THREE.Vector3(0, 1, 0)).normalize();
    const moved = base.sunDir.clone().applyAxisAngle(perp, SUN_STEP_RAD * 1.2);
    expect(rebakeReason(prev, { ...base, sunDir: moved }, 1000 + MIN_BAKE_GAP_MS - 1)).toBeNull();
    expect(rebakeReason(prev, { ...base, sunDir: moved }, 1000 + MIN_BAKE_GAP_MS)).toBe("sun");
    const small = base.sunDir.clone().applyAxisAngle(perp, SUN_STEP_RAD * 0.5);
    expect(rebakeReason(prev, { ...base, sunDir: small }, 5000)).toBeNull();
  });

  it("re-bakes for a daylight step, not for smaller drifts", () => {
    const prev = record(base, 0);
    expect(rebakeReason(prev, { ...base, daylight: base.daylight - DAYLIGHT_STEP }, 1000)).toBe("daylight");
    expect(rebakeReason(prev, { ...base, daylight: base.daylight - DAYLIGHT_STEP / 2 }, 1000)).toBeNull();
  });

  it("ignores sun movement while the sun is down (there is no glow to update)", () => {
    const night = state({ sunElev: -0.5, daylight: 0.07 });
    const prev = record(night, 0);
    const moved = night.sunDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), SUN_STEP_RAD * 3);
    expect(rebakeReason(prev, { ...night, sunDir: moved, sunElev: -0.45 }, 5000)).toBeNull();
  });
});

describe("envIntensity", () => {
  it("changes smoothly with daylight (no steps between bakes)", () => {
    let prev = envIntensity(state({ daylight: 0.07 }));
    for (let d = 0.071; d <= 0.97; d += 0.001) {
      const next = envIntensity(state({ daylight: d }));
      expect(Math.abs(next - prev)).toBeLessThan(0.01 * ENV_BASE);
      expect(next).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = next;
    }
  });
});

describe("SkyEnvironment", () => {
  function fakePmrem() {
    const targets: { texture: THREE.Texture; dispose: ReturnType<typeof vi.fn> }[] = [];
    const pmrem = {
      fromScene: vi.fn(() => {
        const t = { texture: new THREE.Texture(), dispose: vi.fn() };
        targets.push(t);
        return t as unknown as THREE.WebGLRenderTarget;
      }),
      dispose: vi.fn(),
    };
    return { pmrem: pmrem as unknown as PmremLike & typeof pmrem, targets };
  }

  it("bakes once, reuses the map until the sky moves, and disposes what it replaces", () => {
    const { pmrem, targets } = fakePmrem();
    const env = new SkyEnvironment(pmrem);
    expect(env.texture).toBeNull();
    expect(env.update(state(), 0)).toBe("first");
    expect(env.bakes).toBe(1);
    expect(env.texture).toBe(targets[0].texture);
    expect(env.update(state(), 100)).toBeNull();
    expect(env.bakes).toBe(1);
    expect(env.update(state({ world: "titan" }), 150)).toBe("world");
    expect(env.bakes).toBe(2);
    expect(targets[0].dispose).toHaveBeenCalledTimes(1);
    expect(env.texture).toBe(targets[1].texture);
    env.dispose();
    expect(targets[1].dispose).toHaveBeenCalledTimes(1);
    expect(pmrem.dispose).toHaveBeenCalledTimes(1);
    expect(env.texture).toBeNull();
  });
});
