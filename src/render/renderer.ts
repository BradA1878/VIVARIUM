/* ============================================================================
   ThreeRenderer — the imperative canvas. Owns the scene, terrain, and the live
   set of building meshes, reconciled each frame against the worker's snapshot
   (doc §0: the renderer only observes). Decoupled from the sim: the worker ticks
   at its own cadence; this renders at display rate (prototype's 60 Hz render /
   5 Hz sim split). Placement raycasting is layered on in Phase 4.
   ============================================================================ */
import * as THREE from "three";
import type { BuildingDef, BuildingState, Snapshot } from "@shared/types";
import { DEFS, doorCellsOf, SIDE_DELTA } from "@/engine";
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

/** add a small cyan airlock ring on a building's local door side (it then turns
 *  with the building's rotation, landing on the world door side) */
function addAirlock(group: THREE.Object3D, def: BuildingDef): void {
  if (def.door == null) return;
  const [dx, dy] = SIDE_DELTA[def.door];
  const half = (def.foot[0] * CELL) / 2;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.045, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x10202a, emissive: 0x7fd4e8, emissiveIntensity: 0.7, roughness: 0.5 }),
  );
  ring.position.set(dx * half, 0.18, dy * half);
  ring.lookAt(ring.position.x + dx, 0.18, ring.position.z + dy); // torus normal → outward
  ring.name = "airlock";
  group.add(ring);
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
        addAirlock(mesh.object, def);
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

      // corridors orient to neighbours: connect to adjacent corridors or to a
      // door whose exit cell is this corridor ("snap to opening")
      if (entry.mesh.setNeighbors && DEFS[b.defId]?.conduit) {
        let mask = 0;
        for (let s = 0; s < 4; s++) {
          const [ox, oy] = SIDE_DELTA[s];
          const n = ownerOf(b.gx + ox, b.gy + oy);
          if (!n) continue;
          const nd = DEFS[n.defId];
          if (nd?.conduit) mask |= 1 << s;
          else if (nd?.door != null) {
            const dc = doorCellsOf(nd, n);
            if (dc && dc.exit[0] === b.gx && dc.exit[1] === b.gy) mask |= 1 << s;
          }
        }
        entry.mesh.setNeighbors(mask);
      }
    }

    // remove vanished buildings
    for (const [uid, entry] of this.placed) {
      if (!seen.has(uid)) {
        this.buildingsGroup.remove(entry.mesh.object);
        entry.mesh.dispose();
        this.placed.delete(uid);
      }
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
    for (const entry of this.placed.values()) entry.mesh.dispose();
    this.placed.clear();
    this.terrain.dispose();
    this.scene.dispose();
  }
}
