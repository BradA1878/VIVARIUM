/* ============================================================================
   ThreeRenderer — the imperative canvas. Owns the scene, terrain, and the live
   set of building meshes, reconciled each frame against the worker's snapshot
   (doc §0: the renderer only observes). Decoupled from the sim: the worker ticks
   at its own cadence; this renders at display rate (prototype's 60 Hz render /
   5 Hz sim split). Placement raycasting is layered on in Phase 4.
   ============================================================================ */
import * as THREE from "three";
import type { BuildingState, Snapshot } from "@shared/types";
import { DEFS } from "@/engine";
import type { SimBridge } from "@/worker/bridge";
import { SceneManager } from "./three/scene";
import { Terrain } from "./three/terrain";
import { GridSpace } from "./three/coords";
import { createMaterials } from "./three/materials";
import { buildKitMesh, type KitMesh } from "./three/kit";
import { PlacementController, type HoverInfo } from "./three/placement";
import { Atmosphere } from "./three/atmosphere";

interface Placed {
  mesh: KitMesh;
  defId: string;
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
    this.onResize = this.onResize.bind(this);
    window.addEventListener("resize", this.onResize);
  }

  // ---- tool controls (driven by the HUD palette, Phase 5) -------------------
  setTool(defId: string): void { this.placement.setTool(defId); }
  setDemolish(): void { this.placement.setDemolish(); }
  clearTool(): void { this.placement.clearTool(); }
  onHover(cb: (info: HoverInfo | null) => void): void { this.placement.onHover(cb); }

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
      this.scene.render();
      return;
    }
    this.scene.update(snap.tod, snap.weather === "dust");
    this.reconcile(snap);
    this.placement.update();
    this.atmosphere.update(dt, snap.weather === "dust");
    this.scene.render();
  }

  /** add meshes for new buildings, drop meshes for removed ones, update glows */
  private reconcile(snap: Snapshot): void {
    const now = performance.now();
    const seen = new Set<number>();

    for (const b of snap.buildings) {
      seen.add(b.uid);
      let entry = this.placed.get(b.uid);
      if (!entry) {
        const def = DEFS[b.defId];
        if (!def) continue;
        const mesh = buildKitMesh(def, b.uid, this.materials);
        const c = this.grid.footprintCenter(def, b.gx, b.gy);
        mesh.object.position.copy(c);
        this.buildingsGroup.add(mesh.object);
        entry = { mesh, defId: b.defId };
        this.placed.set(b.uid, entry);
      }
      const st = buildingStatus(b);
      const pulse = 0.5 + 0.5 * Math.sin(now / 700 + b.uid);
      const fill = b.defId === "battery" ? snap.pools.power.amount / snap.pools.power.capacity : undefined;
      entry.mesh.setStatus({ ...st, fill }, pulse);
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
    this.placement.dispose();
    this.atmosphere.dispose();
    for (const entry of this.placed.values()) entry.mesh.dispose();
    this.placed.clear();
    this.terrain.dispose();
    this.scene.dispose();
  }
}
