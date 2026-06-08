/* ============================================================================
   PlacementController — turns pointer input over the canvas into build / demolish
   / rotate / route commands. Raycasts the cursor onto the ground plane to find
   the hovered cell, shows a ghost (cyan = ok, rust = blocked), and routes the
   actual mutation through the worker (doc §0: the worker is authoritative; this
   only previews + commands).

   Modes:
   - place: footprint ghost + a door arrow; R rotates; click places with rotation.
   - demolish: highlight + click removes.
   - route (the Corridor tool): click a door-building = source, click another =
     auto-route corridors door→door; clicking empty hand-lays a single corridor.
   - select (no tool): click a placed building to select it, then click an empty
     cell to move it, R to rotate, Del to remove. Right-click / Esc deselects.
   ============================================================================ */
import * as THREE from "three";
import type { Side } from "@shared/types";
import { DEFS, doorCells, SIDE_DELTA } from "@/engine";
import type { SimBridge } from "@/worker/bridge";
import { CELL, GridSpace } from "./coords";

export interface HoverInfo {
  gx: number;
  gy: number;
  defId?: string;
}

export interface SelectInfo {
  uid: number;
  defId: string;
}

type Tool =
  | { kind: "place"; defId: string }
  | { kind: "demolish" }
  | { kind: "route" }
  | null;

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
  private ghostRot: Side = 0;
  private routeSource: number | null = null;
  private selectedUid: number | null = null;

  private tiles: THREE.Mesh[] = [];
  private tileGeo: THREE.PlaneGeometry;
  private tileMat: THREE.MeshBasicMaterial;
  private outline: THREE.LineSegments;
  private arrow: THREE.Mesh;

  private hoverCb: ((info: HoverInfo | null) => void) | null = null;
  private selectCb: ((info: SelectInfo | null) => void) | null = null;
  private lastHoverKey = "";

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.Camera,
    private grid: GridSpace,
    private bridge: SimBridge,
  ) {
    this.tileGeo = new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92).rotateX(-Math.PI / 2);
    this.tileMat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.22, depthWrite: false,
    });
    const og = new THREE.BufferGeometry();
    this.outline = new THREE.LineSegments(
      og, new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.8 }),
    );
    this.group.add(this.outline);

    // door-direction arrow (apex points +Z; we lookAt() to aim it)
    const aGeo = new THREE.ConeGeometry(0.14, 0.34, 4).rotateX(Math.PI / 2);
    this.arrow = new THREE.Mesh(aGeo, new THREE.MeshBasicMaterial({ color: CYAN }));
    this.arrow.visible = false;
    this.group.add(this.arrow);

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
  setTool(defId: string): void { this.tool = { kind: "place", defId }; this.ghostRot = 0; this.routeSource = null; this.setSelected(null); }
  setDemolish(): void { this.tool = { kind: "demolish" }; this.routeSource = null; this.setSelected(null); }
  setRoute(): void { this.tool = { kind: "route" }; this.routeSource = null; this.setSelected(null); }
  clearTool(): void { this.tool = null; this.routeSource = null; this.setSelected(null); }
  onHover(cb: (info: HoverInfo | null) => void): void { this.hoverCb = cb; }
  onSelect(cb: (info: SelectInfo | null) => void): void { this.selectCb = cb; }

  /** R — rotate the ghost while placing, else the selected/hovered building */
  rotate(): void {
    if (this.tool?.kind === "place") { this.ghostRot = ((this.ghostRot + 1) % 4) as Side; return; }
    if (this.selectedUid != null) { this.bridge.rotateUid(this.selectedUid); return; }
    if (this.hover) { const b = this.bridge.buildingAt(this.hover.gx, this.hover.gy); if (b) this.bridge.rotate(b.gx, b.gy); }
  }

  /** Del — remove the selected building */
  removeSelected(): void {
    if (this.selectedUid == null) return;
    const b = this.bridge.buildingByUid(this.selectedUid);
    if (b) this.bridge.remove(b.gx, b.gy);
    this.setSelected(null);
  }

  private setSelected(uid: number | null): void {
    if (this.selectedUid === uid) return;
    this.selectedUid = uid;
    if (this.selectCb) {
      const b = uid != null ? this.bridge.buildingByUid(uid) : null;
      this.selectCb(b ? { uid: b.uid, defId: b.defId } : null);
    }
  }

  // ---- pointer --------------------------------------------------------------
  private onMove(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.hasPointer = true;
  }
  private onLeave(): void { this.hasPointer = false; this.hover = null; }

  private onClick(): void {
    if (!this.hover) return;
    const { gx, gy } = this.hover;
    if (!this.tool) { this.onSelectClick(gx, gy); return; }
    if (this.tool.kind === "demolish") { this.bridge.remove(gx, gy); return; }
    if (this.tool.kind === "place") { this.bridge.place(this.tool.defId, gx, gy, this.ghostRot); return; }
    if (this.tool.kind === "route") {
      const b = this.bridge.buildingAt(gx, gy);
      const isDoor = !!(b && DEFS[b.defId]?.door != null);
      if (isDoor && b) {
        if (this.routeSource == null) this.routeSource = b.uid;
        else if (this.routeSource !== b.uid) { this.bridge.route(this.routeSource, b.uid); this.routeSource = null; }
        else this.routeSource = null; // clicked the source again → deselect
      } else if (!b) {
        this.bridge.place("corridor", gx, gy); // hand-lay a single corridor
      }
    }
  }
  /** no tool: click a building to select it, click empty to move the selection */
  private onSelectClick(gx: number, gy: number): void {
    const b = this.bridge.buildingAt(gx, gy);
    if (b) {
      this.setSelected(this.selectedUid === b.uid ? null : b.uid); // toggle / switch
    } else if (this.selectedUid != null && this.bridge.canMove(this.selectedUid, gx, gy)) {
      this.bridge.move(this.selectedUid, gx, gy); // relocate, keep it selected
    }
  }

  private onContext(e: MouseEvent): void {
    e.preventDefault();
    if (this.selectedUid != null) { this.setSelected(null); return; }
    if (this.tool?.kind === "route" && this.routeSource != null) { this.routeSource = null; return; }
    this.clearTool();
  }

  // ---- per-frame ------------------------------------------------------------
  update(): void {
    if (this.hasPointer) {
      this.ray.setFromCamera(this.ndc, this.camera);
      const hit = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.plane, hit)) {
        const { gx, gy } = this.grid.worldToCell(hit);
        this.hover = this.grid.inBounds(gx, gy) ? { gx, gy } : null;
      } else this.hover = null;
    }

    this.emitHover();
    this.arrow.visible = false;

    if (!this.tool) {
      if (this.selectedUid != null) { this.group.visible = true; this.drawSelectGhost(); }
      else this.group.visible = false;
      return;
    }
    this.group.visible = true;

    if (this.tool.kind === "place") this.hover ? this.drawPlaceGhost() : this.hideTiles();
    else if (this.tool.kind === "demolish") this.hover ? this.drawDemolishGhost() : this.hideTiles();
    else this.drawRouteGhost();
  }

  /** aim the door arrow at a cell's outward side */
  private showArrow(exitGx: number, exitGy: number, side: Side, color: THREE.Color): void {
    const c = this.grid.cellCenter(exitGx, exitGy);
    this.arrow.position.set(c.x, 0.18, c.z);
    const [dx, dy] = SIDE_DELTA[side];
    this.arrow.lookAt(c.x + dx, 0.18, c.z + dy);
    (this.arrow.material as THREE.MeshBasicMaterial).color.copy(color);
    this.arrow.visible = true;
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

  // ---- tile pool ------------------------------------------------------------
  /** ensure `n` tiles exist and return them; hide the rest */
  private useTiles(n: number, color: THREE.Color): THREE.Mesh[] {
    while (this.tiles.length < n) {
      const m = new THREE.Mesh(this.tileGeo, this.tileMat);
      this.tiles.push(m);
      this.group.add(m);
    }
    this.tileMat.color.copy(color);
    for (let i = 0; i < this.tiles.length; i++) this.tiles[i].visible = i < n;
    return this.tiles;
  }
  private hideTiles(): void { for (const t of this.tiles) t.visible = false; this.hideOutline(); }
  private hideOutline(): void { this.outline.visible = false; }

  // ---- place ----------------------------------------------------------------
  private drawPlaceGhost(): void {
    const def = DEFS[(this.tool as { defId: string }).defId];
    const ok = this.bridge.canPlace(def.id, this.hover!.gx, this.hover!.gy);
    const col = ok ? CYAN : RUST;
    const tiles = this.useTiles(def.foot[0] * def.foot[1], col);
    (this.outline.material as THREE.LineBasicMaterial).color.copy(col);

    let i = 0;
    for (let dx = 0; dx < def.foot[0]; dx++)
      for (let dy = 0; dy < def.foot[1]; dy++) {
        const c = this.grid.cellCenter(this.hover!.gx + dx, this.hover!.gy + dy);
        tiles[i++].position.set(c.x, 0.03, c.z);
      }
    this.setOutlineBox(def.foot[0], def.foot[1], this.hover!.gx, this.hover!.gy, 0.6);

    // door arrow: show where the (rotated) door will face
    const d = doorCells(def, this.hover!.gx, this.hover!.gy, this.ghostRot);
    if (d) this.showArrow(d.exit[0], d.exit[1], d.side, col);
  }

  // ---- select / move ---------------------------------------------------------
  private drawSelectGhost(): void {
    const sel = this.bridge.buildingByUid(this.selectedUid!);
    if (!sel) { this.setSelected(null); this.group.visible = false; return; }
    const def = DEFS[sel.defId];

    // always outline the selected building at its current spot
    this.outlineBuilding(sel.gx, sel.gy, sel.defId, CYAN);

    const overBuilding = this.hover ? this.bridge.buildingAt(this.hover.gx, this.hover.gy) : null;
    if (this.hover && !overBuilding) {
      // hovering empty ground → preview the move
      const ok = this.bridge.canMove(sel.uid, this.hover.gx, this.hover.gy);
      const col = ok ? CYAN : RUST;
      const tiles = this.useTiles(def.foot[0] * def.foot[1], col);
      let i = 0;
      for (let dx = 0; dx < def.foot[0]; dx++)
        for (let dy = 0; dy < def.foot[1]; dy++) {
          const c = this.grid.cellCenter(this.hover.gx + dx, this.hover.gy + dy);
          tiles[i++].position.set(c.x, 0.04, c.z);
        }
      const d = doorCells(def, this.hover.gx, this.hover.gy, sel.rot);
      if (d) this.showArrow(d.exit[0], d.exit[1], d.side, col);
    } else {
      this.hideTilesKeepOutline();
      const d = doorCells(def, sel.gx, sel.gy, sel.rot);
      if (d) this.showArrow(d.exit[0], d.exit[1], d.side, CYAN);
    }
  }

  private drawDemolishGhost(): void {
    const b = this.bridge.buildingAt(this.hover!.gx, this.hover!.gy);
    const tiles = this.useTiles(1, RUST);
    (this.outline.material as THREE.LineBasicMaterial).color.copy(RUST);
    const c = this.grid.cellCenter(this.hover!.gx, this.hover!.gy);
    tiles[0].position.set(c.x, 0.03, c.z);
    if (b) { const def = DEFS[b.defId]; this.setOutlineBox(def.foot[0], def.foot[1], b.gx, b.gy, 0.5); }
    else this.setOutlineBox(1, 1, this.hover!.gx, this.hover!.gy, 0.2);
  }

  // ---- route ----------------------------------------------------------------
  private drawRouteGhost(): void {
    const hover = this.hover;
    const b = hover ? this.bridge.buildingAt(hover.gx, hover.gy) : null;
    const isDoor = !!(b && DEFS[b.defId]?.door != null);

    if (this.routeSource != null) {
      // a source is picked — preview the path to the hovered target
      const src = this.bridge.buildingByUid(this.routeSource);
      if (src) this.outlineBuilding(src.gx, src.gy, src.defId, CYAN);
      if (isDoor && b && b.uid !== this.routeSource) {
        const path = this.bridge.previewRoute(this.routeSource, b.uid);
        if (path) { this.layPath(path, CYAN); return; }
        this.useTiles(0, RUST); // no route — show source only
        return;
      }
      this.hideTilesKeepOutline();
      return;
    }

    // no source yet — hint the hovered door-building, or a single-corridor cell
    this.hideOutline();
    if (isDoor && b) { this.outlineBuilding(b.gx, b.gy, b.defId, CYAN); this.useTiles(0, CYAN); }
    else if (hover && !b) { const t = this.useTiles(1, CYAN); const c = this.grid.cellCenter(hover.gx, hover.gy); t[0].position.set(c.x, 0.03, c.z); }
    else this.useTiles(0, CYAN);
  }

  private layPath(path: [number, number][], color: THREE.Color): void {
    const tiles = this.useTiles(path.length, color);
    for (let i = 0; i < path.length; i++) {
      const c = this.grid.cellCenter(path[i][0], path[i][1]);
      tiles[i].position.set(c.x, 0.04, c.z);
    }
  }

  private hideTilesKeepOutline(): void { for (const t of this.tiles) t.visible = false; }

  private outlineBuilding(gx: number, gy: number, defId: string, color: THREE.Color): void {
    const def = DEFS[defId];
    (this.outline.material as THREE.LineBasicMaterial).color.copy(color);
    this.setOutlineBox(def.foot[0], def.foot[1], gx, gy, 0.7);
  }

  /** redraw the wire box around a footprint */
  private setOutlineBox(fw: number, fh: number, gx: number, gy: number, height: number): void {
    this.outline.visible = true;
    const c0 = this.grid.cellCenter(gx, gy);
    const x0 = c0.x - CELL / 2, z0 = c0.z - CELL / 2;
    const x1 = x0 + fw * CELL, z1 = z0 + fh * CELL;
    const y = 0.02, yh = height;
    const pts: number[] = [];
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      pts.push(ax, y, az, bx, y, bz);
      pts.push(ax, y, az, ax, yh, az);
      pts.push(ax, yh, az, bx, yh, bz);
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
    this.tileGeo.dispose();
    this.tileMat.dispose();
    this.outline.geometry.dispose();
    (this.outline.material as THREE.Material).dispose();
    this.arrow.geometry.dispose();
    (this.arrow.material as THREE.Material).dispose();
  }
}
