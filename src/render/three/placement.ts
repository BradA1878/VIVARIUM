/* ============================================================================
   PlacementController — turns pointer input over the canvas into build/demolish
   commands. Raycasts the cursor onto the ground plane to find the hovered cell,
   shows a ghost footprint (cyan = fits, rust = blocked, prototype drawGhost),
   and routes the actual place/remove through the worker (doc §0: the worker is
   authoritative; this only previews + commands).
   ============================================================================ */
import * as THREE from "three";
import { DEFS } from "@/engine";
import type { SimBridge } from "@/worker/bridge";
import { CELL, GridSpace } from "./coords";

export interface HoverInfo {
  gx: number;
  gy: number;
  /** building under the cursor, if any */
  defId?: string;
}

type Tool = { kind: "place"; defId: string } | { kind: "demolish" } | null;

const CYAN = new THREE.Color("#7fd4e8");
const RUST = new THREE.Color("#e8784f");

export class PlacementController {
  readonly group = new THREE.Group();
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2();
  private hasPointer = false;
  private hover: { gx: number; gy: number } | null = null;
  private tool: Tool = null;

  private tiles: THREE.Mesh[] = [];
  private tileMat: THREE.MeshBasicMaterial;
  private outline: THREE.LineSegments;
  private currentFoot = "";

  private hoverCb: ((info: HoverInfo | null) => void) | null = null;
  private lastHoverKey = "";

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.Camera,
    private grid: GridSpace,
    private bridge: SimBridge,
  ) {
    this.tileMat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.22, depthWrite: false,
    });
    const og = new THREE.BufferGeometry();
    this.outline = new THREE.LineSegments(
      og, new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.8 }),
    );
    this.group.add(this.outline);
    this.group.visible = false;

    this.onMove = this.onMove.bind(this);
    this.onLeave = this.onLeave.bind(this);
    this.onClick = this.onClick.bind(this);
    this.onContext = this.onContext.bind(this);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("click", this.onClick);
    canvas.addEventListener("contextmenu", this.onContext);
  }

  // ---- tool state -----------------------------------------------------------
  setTool(defId: string): void { this.tool = { kind: "place", defId }; this.refreshTiles(); }
  setDemolish(): void { this.tool = { kind: "demolish" }; this.refreshTiles(); }
  clearTool(): void { this.tool = null; this.refreshTiles(); }
  onHover(cb: (info: HoverInfo | null) => void): void { this.hoverCb = cb; }

  // ---- pointer --------------------------------------------------------------
  private onMove(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.hasPointer = true;
  }
  private onLeave(): void { this.hasPointer = false; this.hover = null; }

  private onClick(): void {
    if (!this.hover || !this.tool) return;
    if (this.tool.kind === "demolish") {
      this.bridge.remove(this.hover.gx, this.hover.gy);
    } else {
      this.bridge.place(this.tool.defId, this.hover.gx, this.hover.gy);
      // keep the tool active for repeat placement (prototype behaviour)
    }
  }
  private onContext(e: MouseEvent): void { e.preventDefault(); this.clearTool(); }

  // ---- per-frame ------------------------------------------------------------
  update(): void {
    // resolve hovered cell via ground-plane raycast
    if (this.hasPointer) {
      this.ray.setFromCamera(this.ndc, this.camera);
      const hit = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.plane, hit)) {
        const { gx, gy } = this.grid.worldToCell(hit);
        this.hover = this.grid.inBounds(gx, gy) ? { gx, gy } : null;
      } else this.hover = null;
    }

    this.emitHover();

    // ghost is only shown while a tool is active
    if (!this.tool || !this.hover) { this.group.visible = false; return; }
    this.group.visible = true;

    if (this.tool.kind === "place") this.drawPlaceGhost();
    else this.drawDemolishGhost();
  }

  private emitHover(): void {
    if (!this.hoverCb) return;
    if (!this.hover) {
      if (this.lastHoverKey !== "") { this.lastHoverKey = ""; this.hoverCb(null); }
      return;
    }
    const b = this.bridge.buildingAt(this.hover.gx, this.hover.gy);
    const key = `${this.hover.gx},${this.hover.gy},${b?.defId ?? ""}`;
    if (key === this.lastHoverKey) return;
    this.lastHoverKey = key;
    this.hoverCb({ gx: this.hover.gx, gy: this.hover.gy, defId: b?.defId });
  }

  private refreshTiles(): void {
    const foot = this.tool?.kind === "place" ? DEFS[this.tool.defId]?.foot ?? [1, 1] : [1, 1];
    const key = `${this.tool?.kind ?? "none"}:${foot[0]}x${foot[1]}`;
    if (key === this.currentFoot) return;
    this.currentFoot = key;
    for (const t of this.tiles) { this.group.remove(t); t.geometry.dispose(); }
    this.tiles = [];
    const n = this.tool?.kind === "place" ? foot[0] * foot[1] : 1;
    const geo = new THREE.PlaneGeometry(CELL * 0.96, CELL * 0.96).rotateX(-Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, this.tileMat);
      this.tiles.push(m);
      this.group.add(m);
    }
  }

  private drawPlaceGhost(): void {
    const def = DEFS[(this.tool as { defId: string }).defId];
    const ok = this.bridge.canPlace(def.id, this.hover!.gx, this.hover!.gy);
    const col = ok ? CYAN : RUST;
    this.tileMat.color.copy(col);
    (this.outline.material as THREE.LineBasicMaterial).color.copy(col);

    let i = 0;
    for (let dx = 0; dx < def.foot[0]; dx++)
      for (let dy = 0; dy < def.foot[1]; dy++) {
        const c = this.grid.cellCenter(this.hover!.gx + dx, this.hover!.gy + dy);
        const tile = this.tiles[i++];
        if (tile) tile.position.set(c.x, 0.03, c.z);
      }
    this.setOutlineBox(def.foot[0], def.foot[1], this.hover!.gx, this.hover!.gy, 0.6);
  }

  private drawDemolishGhost(): void {
    const b = this.bridge.buildingAt(this.hover!.gx, this.hover!.gy);
    this.tileMat.color.copy(RUST);
    (this.outline.material as THREE.LineBasicMaterial).color.copy(RUST);
    const c = this.grid.cellCenter(this.hover!.gx, this.hover!.gy);
    if (this.tiles[0]) this.tiles[0].position.set(c.x, 0.03, c.z);
    if (b) {
      const def = DEFS[b.defId];
      this.setOutlineBox(def.foot[0], def.foot[1], b.gx, b.gy, 0.5);
    } else {
      this.setOutlineBox(1, 1, this.hover!.gx, this.hover!.gy, 0.2);
    }
  }

  /** redraw the wire box around a footprint */
  private setOutlineBox(fw: number, fh: number, gx: number, gy: number, height: number): void {
    const c0 = this.grid.cellCenter(gx, gy);
    const x0 = c0.x - CELL / 2, z0 = c0.z - CELL / 2;
    const x1 = x0 + fw * CELL, z1 = z0 + fh * CELL;
    const y = 0.02, yh = height;
    const pts: number[] = [];
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      pts.push(ax, y, az, bx, y, bz);        // base ring
      pts.push(ax, y, az, ax, yh, az);       // vertical
      pts.push(ax, yh, az, bx, yh, bz);      // top ring
    }
    this.outline.geometry.dispose();
    this.outline.geometry = new THREE.BufferGeometry();
    this.outline.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  }

  dispose(): void {
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    this.canvas.removeEventListener("click", this.onClick);
    this.canvas.removeEventListener("contextmenu", this.onContext);
    for (const t of this.tiles) t.geometry.dispose();
    this.tileMat.dispose();
    this.outline.geometry.dispose();
    (this.outline.material as THREE.Material).dispose();
  }
}
