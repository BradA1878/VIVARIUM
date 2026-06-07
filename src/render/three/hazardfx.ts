/* ============================================================================
   Transient hazard visual-effects manager. The engine emits ColonyEvents; we
   translate the spatial ones (meteor strikes, quakes, building destruction)
   into short-lived 3D effects parented under a single group. Each effect is a
   tiny self-contained object with a per-frame tick() that animates + fades and
   returns false once it has outlived its lifetime, at which point we dispose
   its geometry/material. Render-layer only — Math.random is fine here.
   ============================================================================ */
import * as THREE from "three";
import type { ColonyEvent } from "@shared/types";
import { GridSpace } from "./coords";

/** One live effect: ticked each frame, removed + disposed when tick → false. */
interface Effect {
  /** advance by dt seconds; return false when finished (ready for disposal). */
  tick(dt: number): boolean;
  /** free per-effect geometry/material (shared resources are NOT freed here). */
  dispose(): void;
}

const RUST = 0xcc5522;
const FLASH = 0xffaa44;
const CYAN_GREY = 0x88bbcc;
const SCORCH = 0x1a1410;
const DEBRIS = 0x33302c;
const SMOKE = 0x222020;

const GRAVITY = 18;

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export class HazardFx {
  readonly group: THREE.Group;

  private readonly grid: GridSpace;
  private readonly effects: Effect[] = [];

  // Shared geometries — reused across effects, disposed once in dispose().
  private readonly sphereGeo: THREE.SphereGeometry;
  private readonly ringGeo: THREE.RingGeometry;
  private readonly discGeo: THREE.CircleGeometry;
  private readonly debrisGeo: THREE.BoxGeometry;

  constructor(grid: GridSpace) {
    this.grid = grid;
    this.group = new THREE.Group();
    this.group.name = "hazardFx";

    this.sphereGeo = new THREE.SphereGeometry(0.16, 12, 10);
    // Unit ring in the XZ plane (built in XY then rotated by each user).
    this.ringGeo = new THREE.RingGeometry(0.78, 1.0, 40);
    this.discGeo = new THREE.CircleGeometry(0.42, 24);
    this.debrisGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  }

  /** Spawn an effect for a relevant event; silently ignore everything else. */
  onEvent(e: ColonyEvent): void {
    if (e.gx === undefined || e.gy === undefined) return;
    const at = this.grid.cellCenter(e.gx, e.gy);

    if (e.type === "strike" && e.detail === "meteor") {
      this.add(new MeteorImpact(this, at, e.hit === true));
    } else if (e.type === "strike" && e.detail === "quake") {
      this.add(new Shockwave(this, at));
    } else if (e.type === "building_destroyed") {
      this.add(new DebrisBurst(this, at));
    }
  }

  /** Advance every live effect; cull + dispose the finished ones. */
  update(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      if (!fx.tick(dt)) {
        fx.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const fx of this.effects) fx.dispose();
    this.effects.length = 0;
    this.group.clear();
    this.sphereGeo.dispose();
    this.ringGeo.dispose();
    this.discGeo.dispose();
    this.debrisGeo.dispose();
    this.group.removeFromParent();
  }

  // --- internal helpers used by the effect classes -------------------------

  private add(fx: Effect): void {
    this.effects.push(fx);
  }

  /** @internal — a flat ring lying on the ground, scaled uniformly. */
  _makeGroundRing(color: number, opacity: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.rotation.x = -Math.PI / 2;
    this.group.add(m);
    return m;
  }

  /** @internal — a glowing sphere (shared geometry, own material). */
  _makeGlowSphere(color: number, opacity: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const m = new THREE.Mesh(this.sphereGeo, mat);
    this.group.add(m);
    return m;
  }

  /** @internal — a flat dark scorch disc on the ground. */
  _makeScorch(): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      color: SCORCH,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const m = new THREE.Mesh(this.discGeo, mat);
    m.rotation.x = -Math.PI / 2;
    this.group.add(m);
    return m;
  }

  /** @internal — a small dark debris cube (shared geometry, own material). */
  _makeDebris(color: number): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      metalness: 0.0,
    });
    const m = new THREE.Mesh(this.debrisGeo, mat);
    this.group.add(m);
    return m;
  }

  /** @internal */
  get _group(): THREE.Group {
    return this.group;
  }
}

/** A single ballistic debris chip: launched outward + up, falls under gravity. */
class Chip {
  readonly mesh: THREE.Mesh;
  private readonly vel: THREE.Vector3;
  private readonly spin: THREE.Vector3;

  constructor(mesh: THREE.Mesh, origin: THREE.Vector3, vel: THREE.Vector3) {
    this.mesh = mesh;
    this.mesh.position.copy(origin);
    this.vel = vel;
    this.spin = new THREE.Vector3(
      (Math.random() - 0.5) * 12,
      (Math.random() - 0.5) * 12,
      (Math.random() - 0.5) * 12,
    );
  }

  step(dt: number): void {
    this.vel.y -= GRAVITY * dt;
    this.mesh.position.addScaledVector(this.vel, dt);
    if (this.mesh.position.y < 0.02) {
      this.mesh.position.y = 0.02;
      this.vel.set(0, 0, 0);
    }
    this.mesh.rotation.x += this.spin.x * dt;
    this.mesh.rotation.y += this.spin.y * dt;
    this.mesh.rotation.z += this.spin.z * dt;
  }
}

/* -------------------------------------------------------------------------- */
/* Meteor impact: streak down, flash ring, debris spray, lingering scorch.     */
/* -------------------------------------------------------------------------- */
class MeteorImpact implements Effect {
  private readonly fx: HazardFx;
  private readonly at: THREE.Vector3;
  private readonly hit: boolean;

  private readonly meteor: THREE.Mesh;
  private flash: THREE.Mesh | null = null;
  private readonly scorch: THREE.Mesh;
  private readonly chips: Chip[] = [];

  private elapsed = 0;
  private impacted = false;

  private readonly fallTime = 0.35;
  private readonly flashTime = 0.5;
  private readonly scorchTime = 4.0;

  constructor(fx: HazardFx, at: THREE.Vector3, hit: boolean) {
    this.fx = fx;
    this.at = at;
    this.hit = hit;

    this.meteor = fx._makeGlowSphere(RUST, 1);
    this.meteor.position.set(at.x, 10, at.z);

    this.scorch = fx._makeScorch();
    this.scorch.position.set(at.x, 0.02, at.z);
    this.scorch.visible = false;
  }

  tick(dt: number): boolean {
    this.elapsed += dt;

    // Phase 1 — fall.
    if (!this.impacted) {
      const k = Math.min(1, this.elapsed / this.fallTime);
      this.meteor.position.y = 10 * (1 - k) + 0.16 * k;
      (this.meteor.material as THREE.MeshBasicMaterial).opacity = 0.9;
      if (k >= 1) this.impact();
      return true;
    }

    const since = this.elapsed - this.fallTime;

    // Flash ring expands + fades.
    if (this.flash) {
      const fk = Math.min(1, since / this.flashTime);
      const max = this.hit ? 1.9 : 1.3;
      const s = 0.2 + easeOut(fk) * max;
      this.flash.scale.set(s, s, s);
      (this.flash.material as THREE.MeshBasicMaterial).opacity = (1 - fk) * (this.hit ? 1 : 0.8);
      if (fk >= 1) {
        this.fx._group.remove(this.flash);
        (this.flash.material as THREE.MeshBasicMaterial).dispose();
        this.flash = null;
      }
    }

    // Debris chips arc + fall.
    for (const c of this.chips) c.step(dt);

    // Scorch lingers then fades out over its final second.
    const sk = since / this.scorchTime;
    const fade = sk < 0.75 ? 1 : Math.max(0, 1 - (sk - 0.75) / 0.25);
    (this.scorch.material as THREE.MeshBasicMaterial).opacity = 0.85 * fade;

    return since < this.scorchTime;
  }

  private impact(): void {
    this.impacted = true;

    // Meteor consumed by the impact.
    this.fx._group.remove(this.meteor);
    (this.meteor.material as THREE.MeshBasicMaterial).dispose();

    // Flash ring.
    this.flash = this.fx._makeGroundRing(FLASH, this.hit ? 1 : 0.8);
    this.flash.position.set(this.at.x, 0.03, this.at.z);

    // Reveal scorch.
    this.scorch.visible = true;

    // Debris spray — a handful arcing up + out.
    const count = this.hit ? 9 : 6;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2.5;
      const vel = new THREE.Vector3(
        Math.cos(ang) * speed,
        3 + Math.random() * 3,
        Math.sin(ang) * speed,
      );
      const chip = new Chip(
        this.fx._makeDebris(DEBRIS),
        new THREE.Vector3(this.at.x, 0.1, this.at.z),
        vel,
      );
      this.chips.push(chip);
    }
  }

  dispose(): void {
    if (this.meteor.parent) {
      this.fx._group.remove(this.meteor);
      (this.meteor.material as THREE.MeshBasicMaterial).dispose();
    }
    if (this.flash) {
      this.fx._group.remove(this.flash);
      (this.flash.material as THREE.MeshBasicMaterial).dispose();
      this.flash = null;
    }
    this.fx._group.remove(this.scorch);
    (this.scorch.material as THREE.MeshBasicMaterial).dispose();
    for (const c of this.chips) {
      this.fx._group.remove(c.mesh);
      (c.mesh.material as THREE.MeshStandardMaterial).dispose();
    }
    this.chips.length = 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Quake: a flat cyan-grey shockwave ring expanding + fading on the ground.    */
/* -------------------------------------------------------------------------- */
class Shockwave implements Effect {
  private readonly fx: HazardFx;
  private readonly ring: THREE.Mesh;
  private elapsed = 0;
  private readonly life = 0.6;

  constructor(fx: HazardFx, at: THREE.Vector3) {
    this.fx = fx;
    this.ring = fx._makeGroundRing(CYAN_GREY, 0.9);
    this.ring.position.set(at.x, 0.03, at.z);
  }

  tick(dt: number): boolean {
    this.elapsed += dt;
    const k = Math.min(1, this.elapsed / this.life);
    const s = 0.2 + easeOut(k) * 2.6;
    this.ring.scale.set(s, s, s);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    return this.elapsed < this.life;
  }

  dispose(): void {
    this.fx._group.remove(this.ring);
    (this.ring.material as THREE.MeshBasicMaterial).dispose();
  }
}

/* -------------------------------------------------------------------------- */
/* Building destroyed: outward debris burst + a brief expanding smoke sphere.   */
/* -------------------------------------------------------------------------- */
class DebrisBurst implements Effect {
  private readonly fx: HazardFx;
  private readonly chips: Chip[] = [];
  private readonly smoke: THREE.Mesh;
  private elapsed = 0;
  private readonly life = 1.0;

  constructor(fx: HazardFx, at: THREE.Vector3) {
    this.fx = fx;

    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      const vel = new THREE.Vector3(
        Math.cos(ang) * speed,
        2.5 + Math.random() * 3.5,
        Math.sin(ang) * speed,
      );
      const chip = new Chip(
        fx._makeDebris(DEBRIS),
        new THREE.Vector3(at.x, 0.2, at.z),
        vel,
      );
      this.chips.push(chip);
    }

    this.smoke = fx._makeGlowSphere(SMOKE, 0.55);
    this.smoke.position.set(at.x, 0.4, at.z);
  }

  tick(dt: number): boolean {
    this.elapsed += dt;
    const k = Math.min(1, this.elapsed / this.life);

    for (const c of this.chips) c.step(dt);

    const s = 0.6 + easeOut(k) * 3.2;
    this.smoke.scale.set(s, s, s);
    this.smoke.position.y = 0.4 + k * 0.6;
    (this.smoke.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.55;

    return this.elapsed < this.life;
  }

  dispose(): void {
    for (const c of this.chips) {
      this.fx._group.remove(c.mesh);
      (c.mesh.material as THREE.MeshStandardMaterial).dispose();
    }
    this.chips.length = 0;
    this.fx._group.remove(this.smoke);
    (this.smoke.material as THREE.MeshBasicMaterial).dispose();
  }
}
