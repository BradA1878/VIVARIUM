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
import { SceneManager } from "./three/scene";
import { Terrain } from "./three/terrain";
import { CELL, GridSpace } from "./three/coords";
import { createMaterials } from "./three/materials";
import { buildKitMesh, type KitMesh } from "./three/kit";
import { PlacementController, type HoverInfo, type SelectInfo } from "./three/placement";
import { Atmosphere } from "./three/atmosphere";
import { HazardFx } from "./three/hazardfx";

interface Placed {
  mesh: KitMesh;
  defId: string;
}

/** a visible door on a building's front (its local def.door side), as a child of
 *  the mesh group so it turns with the building's rotation — this is the cell the
 *  auto-route connects to, so you can see which way to aim it before linking. */
function addDoor(group: THREE.Object3D, def: BuildingDef): void {
  if (def.door == null) return;
  const [dx, dy] = SIDE_DELTA[def.door];
  const half = (def.foot[0] * CELL) / 2;
  const door = new THREE.Group();
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.32, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x0b1014, emissive: 0x2c4a55, emissiveIntensity: 0.5, roughness: 0.6, metalness: 0.3 }),
  );
  frame.position.y = 0.16;
  const sill = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.05, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x10202a, emissive: 0x7fd4e8, emissiveIntensity: 0.7 }),
  );
  sill.position.y = 0.03;
  door.add(frame, sill);
  door.position.set(dx * (half + 0.01), 0, dy * (half + 0.01));
  door.lookAt(door.position.x + dx, 0, door.position.z + dy); // face outward
  door.name = "door";
  group.add(door);
}

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
  private bridge: SimBridge;
  private placement: PlacementController;
  private atmosphere: Atmosphere;
  private hazardFx: HazardFx;
  private unsubEvents: () => void;
  private raf = 0;
  private running = false;
  private lastFrame = 0;

  constructor(canvas: HTMLCanvasElement, bridge: SimBridge, gridN: number) {
    this.bridge = bridge;
    this.scene = new SceneManager(canvas);
    this.grid = new GridSpace(gridN);
    this.terrain = new Terrain(this.grid);
    this.scene.scene.add(this.terrain.group);
    this.scene.scene.add(this.buildingsGroup);
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

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.frame();
      this.raf = requestAnimationFrame(loop);
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
    this.reconcile(snap);
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
        addDoor(mesh.object, def);
        this.buildingsGroup.add(mesh.object);
        entry = { mesh, defId: b.defId };
        this.placed.set(b.uid, entry);
      }
      // facing: turn the building by its rotation (corridors stay at rot 0)
      entry.mesh.object.rotation.y = -((b.rot ?? 0) * Math.PI) / 2;

      const st = buildingStatus(b);
      const pulse = 0.5 + 0.5 * Math.sin(now / 700 + b.uid);
      const fill = b.defId === "battery" ? snap.pools.power.amount / snap.pools.power.capacity : undefined;
      entry.mesh.setStatus({ ...st, fill }, pulse);

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
        this.buildingsGroup.remove(entry.mesh.object);
        entry.mesh.dispose();
        this.placed.delete(uid);
      }
    }
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
    for (const entry of this.placed.values()) entry.mesh.dispose();
    this.placed.clear();
    this.terrain.dispose();
    this.scene.dispose();
  }
}
