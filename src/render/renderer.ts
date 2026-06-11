/* ============================================================================
   ThreeRenderer — the imperative canvas. Owns the scene, terrain, and the live
   set of building meshes, reconciled each frame against the worker's snapshot
   (doc §0: the renderer only observes). Decoupled from the sim: the worker ticks
   at its own cadence; this renders at display rate (prototype's 60 Hz render /
   5 Hz sim split). Placement raycasting is layered on in Phase 4.
   ============================================================================ */
import * as THREE from "three";
import type { BuildingDef, BuildingState, Snapshot } from "@shared/types";
import { DEFS, SIDE_DELTA } from "@/engine";
import type { SimBridge } from "@/worker/bridge";
import { SceneManager, nightLevel } from "./three/scene";
import { Terrain } from "./three/terrain";
import { CELL, GridSpace } from "./three/coords";
import { createMaterials } from "./three/materials";
import { buildKitMesh, type KitMesh, type KitEnv } from "./three/kit";
import { PlacementController, type HoverInfo, type SelectInfo } from "./three/placement";
import { Atmosphere } from "./three/atmosphere";
import { HazardFx } from "./three/hazardfx";
import { buildAstronaut, type AstronautMesh } from "./three/kit/astronaut";
import { buildDeposit, type DepositMesh } from "./three/kit/deposit";
import { buildAlienShip, type AlienShipMesh } from "./three/alienship";
import { buildUfo, type UfoMesh } from "./three/ufo";
import { buildDepot, type DepotMesh } from "./three/depot";

interface Placed {
  mesh: KitMesh;
  defId: string;
}

/** a colonist's render record: its mesh plus the interpolated transform we lerp
 *  toward the snapshot each frame (snapshots arrive ~12fps, we render ~60fps). */
interface ColonistRec {
  mesh: AstronautMesh;
  /** current (smoothed) world position */
  pos: THREE.Vector3;
  /** current (smoothed) facing angle */
  facing: number;
}

/** colonist states that should show the walking bob */
const MOVING_STATES = new Set(["toWork", "toHome", "toMedbay", "mining", "hauling", "piloted"]);

/** prototype status(): the glow that reads a building's health */
function buildingStatus(b: BuildingState): { alive: boolean; hurt: boolean } {
  const def = DEFS[b.defId];
  const alive = b.online && (!def.requiresPressure || b.connected) && b.staffed && b.fed;
  const hurt =
    (def.requiresPressure && !b.connected) ||
    (def.staffing > 0 && !b.staffed) ||
    !b.fed ||
    (!b.online && (def.consumes.power ?? 0) > 0);
  return { alive, hurt };
}

export class ThreeRenderer {
  readonly scene: SceneManager;
  readonly grid: GridSpace;
  private terrain: Terrain;
  private buildingsGroup = new THREE.Group();
  private materials = createMaterials();
  private placed = new Map<number, Placed>();
  // airlocks at corridor↔building junctions, keyed "uid:cx,cy:side"
  private airlocks = new Map<string, THREE.Mesh>();
  private airlockGeo = new THREE.TorusGeometry(0.22, 0.05, 8, 16);
  private airlockMat = new THREE.MeshStandardMaterial({ color: 0x10202a, emissive: 0x7fd4e8, emissiveIntensity: 0.7, roughness: 0.5 });
  // door glows are SHARED across every door so the night ramp is one material
  // write per frame, not a write per door (detached before kit dispose)
  private doorFrameGeo = new THREE.BoxGeometry(0.34, 0.32, 0.06);
  private doorSillGeo = new THREE.BoxGeometry(0.4, 0.05, 0.05);
  private doorGlowMat = new THREE.MeshStandardMaterial({ color: 0x0b1014, emissive: 0x2c4a55, emissiveIntensity: 0.5, roughness: 0.6, metalness: 0.3 });
  private doorSillMat = new THREE.MeshStandardMaterial({ color: 0x10202a, emissive: 0x7fd4e8, emissiveIntensity: 0.7 });
  // per-frame world context handed to every kit (mutated in place — no allocs)
  private env: KitEnv = { night: 0 };
  private bridge: SimBridge;
  private placement: PlacementController;
  private atmosphere: Atmosphere;
  private hazardFx: HazardFx;
  private unsubEvents: () => void;
  private raf = 0;
  private running = false;
  private lastFrame = 0;
  // frame-rate cap — the sim is slow + iso, so ~30fps is plenty and saves a lot
  // of GPU/battery vs rendering at a 120Hz display's full rate (and lower while
  // paused, since almost nothing animates then).
  private lastRender = 0;
  private static readonly FPS_ACTIVE = 30;
  private static readonly FPS_PAUSED = 12;

  // embodied colony: astronauts, deposits, the trader saucer
  private colonists = new Map<number, ColonistRec>();
  private colonistsGroup = new THREE.Group();
  private deposits = new Map<number, DepositMesh>();
  private depositsGroup = new THREE.Group();
  private alienShip: AlienShipMesh | null = null;
  private ufo: UfoMesh | null = null;
  private depot: DepotMesh | null = null;

  // follow-cam: lerped focus + ortho extent driven toward the possessed target
  private camFocus = new THREE.Vector3(0, 0, 0);
  private camView = 13;

  constructor(canvas: HTMLCanvasElement, bridge: SimBridge, gridN: number) {
    this.bridge = bridge;
    this.scene = new SceneManager(canvas);
    this.grid = new GridSpace(gridN);
    this.terrain = new Terrain(this.grid);
    this.scene.scene.add(this.terrain.group);
    this.scene.scene.add(this.buildingsGroup);
    this.scene.scene.add(this.depositsGroup);
    this.scene.scene.add(this.colonistsGroup);
    this.placement = new PlacementController(canvas, this.scene.camera, this.grid, bridge);
    this.scene.scene.add(this.placement.group);
    this.atmosphere = new Atmosphere(this.grid);
    this.scene.scene.add(this.atmosphere.points);
    this.hazardFx = new HazardFx(this.grid);
    this.scene.scene.add(this.hazardFx.group);
    // the renderer observes the event stream for transient hazard FX (doc §0)
    this.unsubEvents = bridge.onEvent((e) => this.hazardFx.onEvent(e));
    this.onResize = this.onResize.bind(this);
    window.addEventListener("resize", this.onResize);
  }

  // ---- tool controls (driven by the HUD palette, Phase 5) -------------------
  setTool(defId: string): void { this.placement.setTool(defId); }
  setDemolish(): void { this.placement.setDemolish(); }
  setRoute(): void { this.placement.setRoute(); }
  rotate(): void { this.placement.rotate(); }
  removeSelected(): void { this.placement.removeSelected(); }
  clearTool(): void { this.placement.clearTool(); }
  onHover(cb: (info: HoverInfo | null) => void): void { this.placement.onHover(cb); }
  onSelect(cb: (info: SelectInfo | null) => void): void { this.placement.onSelect(cb); }

  // graphics tier (default "high") — this exact signature is the contract the
  // upcoming settings UI consumes.
  setQuality(q: "low" | "high"): void { this.scene.setQuality(q); }
  getQuality(): "low" | "high" { return this.scene.getQuality(); }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      // don't render an off-screen tab at all (belt-and-suspenders: rAF already
      // throttles hidden tabs, but this is explicit)
      if (typeof document !== "undefined" && document.hidden) return;
      // cap the frame rate — render at most FPS_ACTIVE (FPS_PAUSED when paused)
      const fps = this.bridge.latest?.paused ? ThreeRenderer.FPS_PAUSED : ThreeRenderer.FPS_ACTIVE;
      const minGap = 1000 / fps - 1; // small slack so we lock cleanly to a divisor of the display rate
      if (t - this.lastRender < minGap) return;
      this.lastRender = t;
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private onResize(): void {
    this.scene.resize();
  }

  private frame(): void {
    const now = performance.now();
    let dt = this.lastFrame ? (now - this.lastFrame) / 1000 : 0.016;
    if (dt > 0.1) dt = 0.1;
    this.lastFrame = now;

    const snap = this.bridge.latest;
    if (!snap) {
      this.atmosphere.update(dt, false);
      this.hazardFx.update(dt);
      this.scene.render();
      return;
    }
    this.scene.update(snap.tod, snap.weather === "dust");
    // one night level per frame drives every kit's status/window ramp plus the
    // shared door + airlock glows (ramped once here instead of per door)
    this.env.night = nightLevel(snap.tod, snap.weather === "dust");
    this.doorGlowMat.emissiveIntensity = 0.5 + 0.7 * this.env.night;
    this.doorSillMat.emissiveIntensity = 0.7 + 0.9 * this.env.night;
    this.airlockMat.emissiveIntensity = 0.7 + 0.9 * this.env.night;
    // solar-flare glow: the postfx exposure/bloom pulse scales with the hazard
    // (full while active, a hint of it during the telegraph)
    let flare = 0;
    for (const h of snap.hazards) {
      if (h.kind !== "flare") continue;
      flare = Math.max(flare, h.phase === "active" ? h.intensity : h.intensity * 0.3);
    }
    this.scene.postfx.setFlare(flare);
    this.scene.postfx.update(dt);
    this.reconcile(snap);
    this.reconcileColonists(snap, dt, now);
    this.reconcileDeposits(snap, now);
    this.reconcileTrade(snap, dt, now);
    this.reconcileUfo(snap, dt, now);
    this.reconcileDepot(snap, now);
    this.updateCamera(snap, dt);
    this.placement.update();
    this.atmosphere.update(dt, snap.weather === "dust");
    this.hazardFx.update(dt);
    this.scene.render();
  }

  /** add meshes for new buildings, drop meshes for removed ones, update glows */
  private reconcile(snap: Snapshot): void {
    const now = performance.now();
    const seen = new Set<number>();

    // occupancy map for corridor neighbour masks (only built if needed)
    let cellOwner: Map<string, BuildingState> | null = null;
    const ownerOf = (x: number, y: number): BuildingState | undefined => {
      if (!cellOwner) {
        cellOwner = new Map();
        for (const bb of snap.buildings) {
          const d = DEFS[bb.defId];
          if (!d) continue;
          for (let dx = 0; dx < d.foot[0]; dx++)
            for (let dy = 0; dy < d.foot[1]; dy++) cellOwner.set(`${bb.gx + dx},${bb.gy + dy}`, bb);
        }
      }
      return cellOwner.get(`${x},${y}`);
    };

    for (const b of snap.buildings) {
      seen.add(b.uid);
      let entry = this.placed.get(b.uid);
      if (!entry) {
        const def = DEFS[b.defId];
        if (!def) continue;
        const mesh = buildKitMesh(def, b.uid, this.materials);
        const c = this.grid.footprintCenter(def, b.gx, b.gy);
        mesh.object.position.copy(c);
        this.addDoor(mesh.object, def);
        this.buildingsGroup.add(mesh.object);
        entry = { mesh, defId: b.defId };
        this.placed.set(b.uid, entry);
      }
      // facing: turn the building by its rotation (corridors stay at rot 0)
      entry.mesh.object.rotation.y = -((b.rot ?? 0) * Math.PI) / 2;

      const st = buildingStatus(b);
      const pulse = 0.5 + 0.5 * Math.sin(now / 700 + b.uid);
      const fill = b.defId === "battery" ? snap.pools.power.amount / snap.pools.power.capacity : undefined;
      entry.mesh.setStatus({ ...st, fill }, pulse, this.env);

      // corridors orient to neighbours: an arm toward each adjacent corridor or
      // sealed building, so a run reads as one connected pipe meeting the airlocks
      if (entry.mesh.setNeighbors && DEFS[b.defId]?.conduit) {
        let mask = 0;
        for (let s = 0; s < 4; s++) {
          const [ox, oy] = SIDE_DELTA[s];
          const n = ownerOf(b.gx + ox, b.gy + oy);
          if (!n) continue;
          const nd = DEFS[n.defId];
          if (nd && (nd.conduit || nd.requiresPressure || nd.isHub)) mask |= 1 << s;
        }
        entry.mesh.setNeighbors(mask);
      }
    }

    // airlocks render where a corridor actually meets a sealed building, so they
    // line up with the corridor arms instead of floating on a fixed door side
    this.updateAirlocks(snap, ownerOf);

    // remove vanished buildings
    for (const [uid, entry] of this.placed) {
      if (!seen.has(uid)) {
        // detach the door first — its geo/mats are shared, owned by this class
        const door = entry.mesh.object.getObjectByName("door");
        if (door) entry.mesh.object.remove(door);
        this.buildingsGroup.remove(entry.mesh.object);
        entry.mesh.dispose();
        this.placed.delete(uid);
      }
    }
  }

  /** a visible door on a building's front (its local def.door side), as a child of
   *  the mesh group so it turns with the building's rotation — this is the cell the
   *  auto-route connects to, so you can see which way to aim it before linking. */
  private addDoor(group: THREE.Object3D, def: BuildingDef): void {
    if (def.door == null) return;
    const [dx, dy] = SIDE_DELTA[def.door];
    const half = (def.foot[0] * CELL) / 2;
    const door = new THREE.Group();
    const frame = new THREE.Mesh(this.doorFrameGeo, this.doorGlowMat);
    frame.position.y = 0.16;
    const sill = new THREE.Mesh(this.doorSillGeo, this.doorSillMat);
    sill.position.y = 0.03;
    door.add(frame, sill);
    door.position.set(dx * (half + 0.01), 0, dy * (half + 0.01));
    door.lookAt(door.position.x + dx, 0, door.position.z + dy); // face outward
    door.name = "door";
    group.add(door);
  }

  /** place a lit airlock on every building edge that abuts a corridor */
  private updateAirlocks(snap: Snapshot, ownerOf: (x: number, y: number) => BuildingState | undefined): void {
    const needed = new Set<string>();
    for (const b of snap.buildings) {
      const d = DEFS[b.defId];
      if (!d || !(d.requiresPressure || d.isHub)) continue; // only sealed buildings have airlocks
      for (let dx = 0; dx < d.foot[0]; dx++)
        for (let dy = 0; dy < d.foot[1]; dy++) {
          const cx = b.gx + dx, cy = b.gy + dy;
          for (let s = 0; s < 4; s++) {
            const [ox, oy] = SIDE_DELTA[s];
            const n = ownerOf(cx + ox, cy + oy);
            if (!n || !DEFS[n.defId]?.conduit) continue;
            const key = `${b.uid}:${cx},${cy}:${s}`;
            needed.add(key);
            let m = this.airlocks.get(key);
            if (!m) { m = new THREE.Mesh(this.airlockGeo, this.airlockMat); this.buildingsGroup.add(m); this.airlocks.set(key, m); }
            const c = this.grid.cellCenter(cx, cy);
            m.position.set(c.x + ox * 0.5 * CELL, 0.14, c.z + oy * 0.5 * CELL);
            m.lookAt(m.position.x + ox, 0.14, m.position.z + oy); // torus normal → toward the corridor
          }
        }
    }
    for (const [key, m] of this.airlocks) {
      if (!needed.has(key)) { this.buildingsGroup.remove(m); this.airlocks.delete(key); }
    }
  }

  /** astronauts: add/remove per colonist id, lerp position + facing toward the
   *  snapshot (smooth between ~12fps snapshots), bob while moving, and drive the
   *  possessed ring + carry cube. facing = atan2(dx,dy) in grid space maps to
   *  group.rotation.y directly (grid +x→world +x, grid +y→world +z). */
  private reconcileColonists(snap: Snapshot, dt: number, now: number): void {
    const seen = new Set<number>();
    const posLerp = 1 - Math.exp(-12 * dt); // frame-rate independent smoothing
    const pulse = 0.5 + 0.5 * Math.sin(now / 400);

    for (const c of snap.colonists) {
      seen.add(c.id);
      let rec = this.colonists.get(c.id);
      const target = this.grid.cellPoint(c.x, c.y);
      if (!rec) {
        const mesh = buildAstronaut();
        this.colonistsGroup.add(mesh.object);
        rec = { mesh, pos: target.clone(), facing: c.facing };
        this.colonists.set(c.id, rec);
      }
      // interpolate world position toward the snapshot
      rec.pos.lerp(target, posLerp);
      rec.mesh.object.position.copy(rec.pos);

      // smoothly turn toward facing (shortest angular path)
      let d = c.facing - rec.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      rec.facing += d * posLerp;
      rec.mesh.object.rotation.y = rec.facing;

      // walking bob on the inner body (only while moving/working on the surface)
      const moving = MOVING_STATES.has(c.state);
      rec.mesh.body.position.y = moving ? Math.abs(Math.sin(now / 130 + c.id)) * 0.05 : 0;

      rec.mesh.setState(c.id === snap.possessed, c.carryKind, pulse, this.env);
    }

    for (const [id, rec] of this.colonists) {
      if (!seen.has(id)) {
        this.colonistsGroup.remove(rec.mesh.object);
        rec.mesh.dispose();
        this.colonists.delete(id);
      }
    }
  }

  /** deposits: a mesh per surface node, scaled by amount/max, removed on vanish */
  private reconcileDeposits(snap: Snapshot, now: number): void {
    const seen = new Set<number>();
    const pulse = 0.5 + 0.5 * Math.sin(now / 600);
    for (const d of snap.deposits) {
      seen.add(d.id);
      let mesh = this.deposits.get(d.id);
      if (!mesh) {
        mesh = buildDeposit(d.kind, d.id * 2654435761);
        const c = this.grid.cellCenter(d.gx, d.gy);
        mesh.object.position.copy(c);
        this.depositsGroup.add(mesh.object);
        this.deposits.set(d.id, mesh);
      }
      mesh.setAmount(d.max > 0 ? d.amount / d.max : 0);
      mesh.setPulse(pulse);
    }
    for (const [id, mesh] of this.deposits) {
      if (!seen.has(id)) {
        this.depositsGroup.remove(mesh.object);
        mesh.dispose();
        this.deposits.delete(id);
      }
    }
  }

  /** the trader saucer: create on first trade, animate by phase, dispose on null */
  private reconcileTrade(snap: Snapshot, dt: number, now: number): void {
    const trade = snap.trade;
    if (!trade) {
      if (this.alienShip) {
        this.scene.scene.remove(this.alienShip.object);
        this.alienShip.dispose();
        this.alienShip = null;
      }
      return;
    }
    if (!this.alienShip) {
      this.alienShip = buildAlienShip();
      this.scene.scene.add(this.alienShip.object);
    }
    const c = this.grid.cellCenter(trade.gx, trade.gy);
    this.alienShip.object.position.x = c.x;
    this.alienShip.object.position.z = c.z;
    this.alienShip.update(trade.phase, dt, now);
  }

  /** the evil UFO: create on first sighting, hover over its victim (tracking the
   *  colonist's smoothed position so the beam follows them), dispose on null */
  private reconcileUfo(snap: Snapshot, dt: number, now: number): void {
    const ufo = snap.ufo;
    if (!ufo) {
      if (this.ufo) {
        this.scene.scene.remove(this.ufo.object);
        this.ufo.dispose();
        this.ufo = null;
      }
      return;
    }
    if (!this.ufo) {
      this.ufo = buildUfo();
      this.scene.scene.add(this.ufo.object);
    }
    // follow the targeted colonist's interpolated world position if we have it,
    // else fall back to the UFO's last-known cell from the snapshot
    const rec = ufo.targetId != null ? this.colonists.get(ufo.targetId) : undefined;
    const p = rec ? rec.pos : this.grid.cellCenter(ufo.gx, ufo.gy);
    this.ufo.object.position.x = p.x;
    this.ufo.object.position.z = p.z;
    this.ufo.update(ufo.phase, dt, now);
  }

  /** the collection depot: a fixed hopper at the depot cell, glowing brighter when
   *  the possessed colonist is carrying a load and standing in drop range */
  private reconcileDepot(snap: Snapshot, now: number): void {
    if (!this.depot) {
      this.depot = buildDepot();
      this.scene.scene.add(this.depot.object);
    }
    const c = this.grid.cellCenter(snap.depot.gx, snap.depot.gy);
    this.depot.object.position.set(c.x, 0, c.z);
    // "ready to receive" when the piloted colonist is carrying + within range
    let active = 0;
    const me = snap.possessed != null ? snap.colonists.find((cc) => cc.id === snap.possessed) : undefined;
    if (me && me.carryAmt > 0 && Math.hypot(snap.depot.gx - me.x, snap.depot.gy - me.y) <= 1.5) active = 1;
    this.depot.setGlow(active, 0.5 + 0.5 * Math.sin(now / 360));
  }

  /** follow-cam: lerp focus + ortho extent toward the possessed colonist (zoomed
   *  in) or back to the overview (origin, wide) when nothing is piloted. */
  private updateCamera(snap: Snapshot, dt: number): void {
    let targetFocus: THREE.Vector3;
    let targetView: number;
    const rec = snap.possessed != null ? this.colonists.get(snap.possessed) : undefined;
    if (rec) {
      targetFocus = rec.pos.clone();
      targetView = 5.5;
    } else {
      // overview: frame the colony (centroid of its buildings) so it stays
      // centered wherever it sits on the larger grid, wide enough to see the
      // buildable area around it
      targetFocus = this.colonyCentroid(snap);
      targetView = 13;
    }
    const k = 1 - Math.exp(-6 * dt);
    this.camFocus.lerp(targetFocus, k);
    this.camView += (targetView - this.camView) * k;
    this.scene.setView(this.camFocus, this.camView);
  }

  /** world-space centroid of all placed buildings (origin if none) */
  private colonyCentroid(snap: Snapshot): THREE.Vector3 {
    const c = new THREE.Vector3();
    let n = 0;
    for (const b of snap.buildings) {
      const def = DEFS[b.defId];
      if (!def) continue;
      c.add(this.grid.footprintCenter(def, b.gx, b.gy));
      n++;
    }
    if (n > 0) c.divideScalar(n);
    return c;
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.unsubEvents();
    this.placement.dispose();
    this.atmosphere.dispose();
    this.hazardFx.dispose();
    this.airlockGeo.dispose();
    this.airlockMat.dispose();
    this.airlocks.clear();
    this.doorFrameGeo.dispose();
    this.doorSillGeo.dispose();
    this.doorGlowMat.dispose();
    this.doorSillMat.dispose();
    for (const entry of this.placed.values()) {
      // detach the door first (as on removal) so the kit dispose can't
      // re-dispose the shared door geo/mats already disposed above
      const door = entry.mesh.object.getObjectByName("door");
      if (door) entry.mesh.object.remove(door);
      entry.mesh.dispose();
    }
    this.placed.clear();
    for (const rec of this.colonists.values()) rec.mesh.dispose();
    this.colonists.clear();
    for (const mesh of this.deposits.values()) mesh.dispose();
    this.deposits.clear();
    if (this.alienShip) { this.alienShip.dispose(); this.alienShip = null; }
    if (this.ufo) { this.ufo.dispose(); this.ufo = null; }
    if (this.depot) { this.depot.dispose(); this.depot = null; }
    this.terrain.dispose();
    this.scene.dispose();
  }
}
