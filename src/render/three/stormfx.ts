/* ============================================================================
   StormFx — the kinetic layer of a dust storm. The Atmosphere supplies the
   ambient veil; this is the weather you can *watch*: dust devils that wander
   the plain while a dust hazard is active, and low wind streaks that pick up
   during the telegraph (the visible warning gusts before the veil closes in).
   Render-only — reads snap.hazards/weather, never touches the sim. All pooled
   geometry lives for the session and is disposed once in dispose().
   ============================================================================ */
import * as THREE from "three";
import type { Snapshot } from "@shared/types";
import { GridSpace } from "./coords";
import { greebleRng } from "./kit/contract";

const DUST = 0xa87850;
const DEVILS = 4;        // pooled rigs; an active storm wakes 2..4 of them
const DEVIL_FADE = 1.5;  // seconds of opacity ramp at both ends of a life
const STREAKS = 200;     // wind-streak segments — one LineSegments draw call

// base opacities (NORMAL blending on purpose — additive would whiten the dust)
const OUTER_OP = 0.16;
const INNER_OP = 0.1;
const SKIRT_OP = 0.08;

interface DevilRig {
  group: THREE.Group;
  outer: THREE.Mesh;
  inner: THREE.Mesh;
  outerMat: THREE.MeshBasicMaterial;
  innerMat: THREE.MeshBasicMaterial;
  skirtMat: THREE.MeshBasicMaterial;
  active: boolean;
  /** debug devils ride out their full life even with no storm */
  forced: boolean;
  life: number;
  maxLife: number;
  vx: number;
  vz: number;
  spin: number;
}

export class StormFx {
  readonly group = new THREE.Group();

  // seeded stream (no Math.random) so the storm has the same character per session
  private readonly rng = greebleRng(0x57f0a7);
  /** wander bounds for the devils (grid + margin) */
  private readonly bound: number;

  // devil geometry is shared across the pool; materials are per rig so each
  // fades independently
  private readonly outerGeo = new THREE.CylinderGeometry(0.55, 0.16, 3.0, 12, 1, true);
  private readonly innerGeo = new THREE.CylinderGeometry(0.34, 0.1, 2.7, 10, 1, true);
  private readonly skirtGeo = new THREE.CylinderGeometry(0.85, 1.15, 0.45, 12, 1, true);
  private readonly devils: DevilRig[] = [];

  // wind streaks: short +X segments advected and wrapped like the atmosphere points
  private readonly streaks: THREE.LineSegments;
  private readonly streakGeo = new THREE.BufferGeometry();
  private readonly streakMat: THREE.LineBasicMaterial;
  private readonly streakPos: Float32Array;
  private readonly streakSpeed: Float32Array;
  private readonly spanX: number;
  private readonly spanZ: number;
  private wind = 0; // smoothed 0..1 storm factor driving the streaks

  constructor(grid: GridSpace) {
    this.group.name = "stormFx";
    this.bound = grid.half() + 2;
    const half = grid.half() + 8; // same margin the atmosphere scatters over
    this.spanX = half * 2;
    this.spanZ = half * 2;

    for (let i = 0; i < DEVILS; i++) this.devils.push(this.buildDevil());

    this.streakPos = new Float32Array(STREAKS * 6);
    this.streakSpeed = new Float32Array(STREAKS);
    for (let i = 0; i < STREAKS; i++) {
      const o = i * 6;
      const x = (this.rng() - 0.5) * this.spanX;
      const y = 0.15 + this.rng() * 3.2;
      const z = (this.rng() - 0.5) * this.spanZ;
      const len = 0.4 + this.rng() * 0.6;
      this.streakPos[o] = x;
      this.streakPos[o + 1] = y;
      this.streakPos[o + 2] = z;
      this.streakPos[o + 3] = x + len;
      this.streakPos[o + 4] = y;
      this.streakPos[o + 5] = z;
      this.streakSpeed[i] = 3 + this.rng() * 4;
    }
    this.streakGeo.setAttribute("position", new THREE.BufferAttribute(this.streakPos, 3));
    this.streakMat = new THREE.LineBasicMaterial({
      color: DUST,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.streaks = new THREE.LineSegments(this.streakGeo, this.streakMat);
    this.streaks.renderOrder = 9;
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    this.group.add(this.streaks);
  }

  /** drive everything off the snapshot: devils while a dust hazard is active,
   *  warning streaks from the telegraph onward */
  update(dt: number, snap: Snapshot | null): void {
    let active = snap?.weather === "dust";
    let telegraph = false;
    let intensity = 0;
    if (snap) {
      for (const h of snap.hazards) {
        if (h.kind !== "dust") continue;
        if (h.phase === "active") {
          active = true;
          intensity = Math.max(intensity, h.intensity);
        } else telegraph = true;
      }
    }
    // streaks reach ~0.3 opacity during the telegraph, ~0.35 in the storm proper
    this.updateStreaks(dt, active ? 1 : telegraph ? 0.85 : 0);
    const want = active ? Math.min(DEVILS, 2 + Math.round(2 * intensity)) : 0;
    this.updateDevils(dt, active, want);
  }

  /** DEV verification path (renderer.debugFx): force one devil to life now */
  debugDevil(): void {
    const d = this.devils.find((x) => !x.active) ?? this.devils[0];
    this.spawn(d, true);
    // pull it near the colony so a screenshot actually frames it
    d.group.position.set((this.rng() - 0.5) * 6, 0, (this.rng() - 0.5) * 6);
  }

  dispose(): void {
    this.outerGeo.dispose();
    this.innerGeo.dispose();
    this.skirtGeo.dispose();
    for (const d of this.devils) {
      d.outerMat.dispose();
      d.innerMat.dispose();
      d.skirtMat.dispose();
    }
    this.streakGeo.dispose();
    this.streakMat.dispose();
    this.group.removeFromParent();
  }

  // --- internals --------------------------------------------------------------

  private makeDustMat(opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color: DUST,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  /** two nested counter-rotating open shells + a squat base skirt, idle until
   *  spawned. Small opposite tilts make the counter-rotation read as a churn. */
  private buildDevil(): DevilRig {
    const group = new THREE.Group();
    group.visible = false;
    const outerMat = this.makeDustMat(OUTER_OP);
    const innerMat = this.makeDustMat(INNER_OP);
    const skirtMat = this.makeDustMat(SKIRT_OP);
    const outerTilt = new THREE.Group();
    outerTilt.rotation.z = 0.07;
    outerTilt.position.y = 1.5;
    const innerTilt = new THREE.Group();
    innerTilt.rotation.z = -0.09;
    innerTilt.position.y = 1.38;
    const outer = new THREE.Mesh(this.outerGeo, outerMat);
    const inner = new THREE.Mesh(this.innerGeo, innerMat);
    const skirt = new THREE.Mesh(this.skirtGeo, skirtMat);
    outer.renderOrder = 10;
    inner.renderOrder = 10;
    skirt.renderOrder = 10;
    skirt.position.y = 0.22;
    outerTilt.add(outer);
    innerTilt.add(inner);
    group.add(outerTilt, innerTilt, skirt);
    this.group.add(group);
    return {
      group, outer, inner, outerMat, innerMat, skirtMat,
      active: false, forced: false, life: 0, maxLife: 1, vx: 0, vz: 0, spin: 1,
    };
  }

  private spawn(d: DevilRig, forced: boolean): void {
    d.active = true;
    d.forced = forced;
    d.life = 0;
    d.maxLife = 8 + this.rng() * 7; // 8..15 s
    d.group.position.set((this.rng() - 0.5) * 2 * this.bound, 0, (this.rng() - 0.5) * 2 * this.bound);
    // mostly downwind (+X, the atmosphere's drift) with a cross-grid wander
    d.vx = 0.5 + this.rng();
    d.vz = (this.rng() - 0.5) * 1.4;
    d.spin = 2.5 + this.rng() * 2.5;
    const s = 0.8 + this.rng() * 0.5;
    d.group.scale.set(s, 0.85 + this.rng() * 0.4, s);
    d.outerMat.opacity = 0;
    d.innerMat.opacity = 0;
    d.skirtMat.opacity = 0;
    d.group.visible = true;
  }

  private updateDevils(dt: number, storming: boolean, want: number): void {
    let alive = 0;
    for (const d of this.devils) if (d.active) alive++;
    for (const d of this.devils) {
      if (!d.active) {
        // respawn while the storm lasts (and only up to the intensity's count)
        if (storming && alive < want) {
          this.spawn(d, false);
          alive++;
        }
        continue;
      }
      // storm over: finish the fade-out, never extend (debug devils ride it out)
      if (!storming && !d.forced) d.maxLife = Math.min(d.maxLife, d.life + DEVIL_FADE);
      d.life += dt;
      if (d.life >= d.maxLife) {
        d.active = false;
        d.group.visible = false;
        continue;
      }
      // wander, bouncing off the grid+margin bounds
      d.group.position.x += d.vx * dt;
      d.group.position.z += d.vz * dt;
      if (d.group.position.x > this.bound) { d.group.position.x = this.bound; d.vx = -Math.abs(d.vx); }
      else if (d.group.position.x < -this.bound) { d.group.position.x = -this.bound; d.vx = Math.abs(d.vx); }
      if (d.group.position.z > this.bound) { d.group.position.z = this.bound; d.vz = -Math.abs(d.vz); }
      else if (d.group.position.z < -this.bound) { d.group.position.z = -this.bound; d.vz = Math.abs(d.vz); }
      d.outer.rotation.y += d.spin * dt;
      d.inner.rotation.y -= d.spin * 1.7 * dt;
      // 1.5s opacity fade at both ends of the 8-15s life
      const k = Math.max(0, Math.min(1, d.life / DEVIL_FADE, (d.maxLife - d.life) / DEVIL_FADE));
      d.outerMat.opacity = OUTER_OP * k;
      d.innerMat.opacity = INNER_OP * k;
      d.skirtMat.opacity = SKIRT_OP * k;
    }
  }

  private updateStreaks(dt: number, target: number): void {
    // ease like the atmosphere's storm factor, so gusts ramp rather than snap
    this.wind += (target - this.wind) * Math.min(1, dt * 1.5);
    const on = this.wind > 0.01;
    this.streaks.visible = on;
    if (!on) return;
    this.streakMat.opacity = 0.35 * this.wind;
    const halfX = this.spanX / 2;
    const drift = (1.5 + 6.5 * this.wind) * dt; // +X, the atmosphere's direction
    for (let i = 0; i < STREAKS; i++) {
      const o = i * 6;
      const step = this.streakSpeed[i] * drift;
      this.streakPos[o] += step;
      this.streakPos[o + 3] += step;
      if (this.streakPos[o] > halfX) {
        // wrap to the windward edge on a fresh lane
        this.streakPos[o] -= this.spanX;
        this.streakPos[o + 3] -= this.spanX;
        const y = 0.15 + this.rng() * 3.2;
        const z = (this.rng() - 0.5) * this.spanZ;
        this.streakPos[o + 1] = y;
        this.streakPos[o + 4] = y;
        this.streakPos[o + 2] = z;
        this.streakPos[o + 5] = z;
      }
    }
    this.streakGeo.attributes.position.needsUpdate = true;
  }
}
