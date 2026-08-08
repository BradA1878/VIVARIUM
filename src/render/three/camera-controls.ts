/* ============================================================================
   CameraControls — desktop pan / zoom layered over the automatic isometric
   camera anchor. The renderer still decides what the camera follows (colony,
   astronaut, or rover); this class owns only the user's persistent offset and
   zoom. Keeping those two concerns separate prevents the follow-cam from
   overwriting mouse input on the next frame.

   Mouse contract:
   - left-drag (after a small threshold) or middle-drag pans;
   - an ordinary left click is untouched for placement / selection;
   - the synthetic click after a drag is consumed exactly once;
   - the wheel zooms, while ctrl/cmd-wheel remains available to the browser;
   - touch and pen are ignored so the two-tap placement contract is unchanged.
   ============================================================================ */
import * as THREE from "three";

export const CAMERA_MIN_VIEW = 3;
export const CAMERA_MAX_VIEW = 22;
export const CAMERA_DRAG_THRESHOLD = 5;
/** One explicit-button press is a reversible ~20% zoom step. Keeping it in the
 *  same delta vocabulary as a wheel gesture means every input shares the rig's
 *  active profile, min/max clamp, and reset lifecycle. */
export const CAMERA_BUTTON_ZOOM_DELTA = 150;

const WHEEL_ZOOM_RATE = 0.0015;

interface CameraProfile {
  offset: THREE.Vector3;
  zoom: number;
}

function profile(): CameraProfile {
  return { offset: new THREE.Vector3(), zoom: 1 };
}

/** Convert WheelEvent units into CSS-pixel-like units. */
export function wheelPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return deltaY * 16; // DOM_DELTA_LINE
  if (deltaMode === 2) return deltaY * Math.max(1, pageHeight); // DOM_DELTA_PAGE
  return deltaY; // DOM_DELTA_PIXEL
}

/** Pure camera intent. Kept independent from DOM input so profile and clamp
 *  behavior can be covered in the Node test suite. */
export class CameraRig {
  private readonly overview = profile();
  private readonly pilot = profile();
  private active: "overview" | "pilot" = "overview";
  private world: string | null = null;
  private pilotKey: string | null = null;

  constructor(
    private readonly focusLimit: number,
    private readonly minView = CAMERA_MIN_VIEW,
    private readonly maxView = CAMERA_MAX_VIEW,
  ) {}

  /** Overview keeps its own framing while the temporary pilot profile starts
   *  centered on every boarding. A world hop resets both profiles. */
  setContext(world: string, pilotKey: string | null): void {
    if (this.world !== null && world !== this.world) this.reset();
    this.world = world;

    if (pilotKey === null) {
      this.active = "overview";
      return;
    }

    if (this.active !== "pilot" || this.pilotKey !== pilotKey) this.resetProfile(this.pilot);
    this.active = "pilot";
    this.pilotKey = pilotKey;
  }

  currentOffset(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.current().offset);
  }

  setOffset(offset: THREE.Vector3, anchor: THREE.Vector3): void {
    const p = this.current();
    p.offset.copy(offset);
    this.clampOffset(p, anchor);
  }

  /** Positive delta zooms out; negative delta zooms in. */
  zoomBy(deltaPixels: number, baseView: number): void {
    if (!Number.isFinite(deltaPixels) || deltaPixels === 0 || baseView <= 0) return;
    const p = this.current();
    const currentView = this.viewFor(baseView);
    const nextView = THREE.MathUtils.clamp(
      currentView * Math.exp(deltaPixels * WHEEL_ZOOM_RATE),
      this.minView,
      this.maxView,
    );
    p.zoom = nextView / baseView;
  }

  focusFor(anchor: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const p = this.current();
    this.clampOffset(p, anchor);
    return out.copy(anchor).add(p.offset);
  }

  viewFor(baseView: number): number {
    return THREE.MathUtils.clamp(baseView * this.current().zoom, this.minView, this.maxView);
  }

  info(): { profile: "overview" | "pilot"; offset: { x: number; z: number }; zoom: number } {
    const p = this.current();
    return { profile: this.active, offset: { x: p.offset.x, z: p.offset.z }, zoom: p.zoom };
  }

  /** A new run / colony may share the same world, so lifecycle owners also have
   *  an explicit reset path instead of relying only on setContext(world). */
  reset(): void {
    this.resetProfile(this.overview);
    this.resetProfile(this.pilot);
  }

  private current(): CameraProfile {
    return this.active === "pilot" ? this.pilot : this.overview;
  }

  private clampOffset(p: CameraProfile, anchor: THREE.Vector3): void {
    p.offset.x = THREE.MathUtils.clamp(p.offset.x, -this.focusLimit - anchor.x, this.focusLimit - anchor.x);
    p.offset.y = 0;
    p.offset.z = THREE.MathUtils.clamp(p.offset.z, -this.focusLimit - anchor.z, this.focusLimit - anchor.z);
  }

  private resetProfile(p: CameraProfile): void {
    p.offset.set(0, 0, 0);
    p.zoom = 1;
  }
}

interface DragState {
  pointerId: number;
  button: number;
  startX: number;
  startY: number;
  startOffset: THREE.Vector3;
  worldPerPixelX: THREE.Vector3;
  worldPerPixelY: THREE.Vector3;
  dragging: boolean;
}

interface SuppressedClick {
  x: number;
  y: number;
  until: number;
}

export class CameraControls {
  readonly rig: CameraRig;

  private readonly ray = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly anchor = new THREE.Vector3();
  private readonly pointA = new THREE.Vector3();
  private readonly pointB = new THREE.Vector3();
  private readonly pointC = new THREE.Vector3();
  private readonly nextOffset = new THREE.Vector3();
  private baseView = 13;
  private drag: DragState | null = null;
  private suppressedClick: SuppressedClick | null = null;
  private suppressTimer: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.OrthographicCamera,
    focusLimit: number,
  ) {
    this.rig = new CameraRig(focusLimit);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onLostPointerCapture = this.onLostPointerCapture.bind(this);
    this.onClickCapture = this.onClickCapture.bind(this);
    this.onAuxClick = this.onAuxClick.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onWindowBlur = this.onWindowBlur.bind(this);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("lostpointercapture", this.onLostPointerCapture);
    canvas.addEventListener("click", this.onClickCapture, true);
    canvas.addEventListener("auxclick", this.onAuxClick);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("blur", this.onWindowBlur);
  }

  setContext(world: string, pilotKey: string | null): void {
    this.rig.setContext(world, pilotKey);
  }

  focusFor(anchor: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.anchor.copy(anchor);
    return this.rig.focusFor(anchor, out);
  }

  viewFor(baseView: number): number {
    this.baseView = baseView;
    return this.rig.viewFor(baseView);
  }

  /** Public zoom seam for non-canvas controls. Wheel and HUD buttons both end
   *  here before CameraRig applies the active profile and view clamps. */
  zoomBy(deltaPixels: number): void {
    this.rig.zoomBy(deltaPixels, this.baseView);
  }

  zoomStep(direction: "in" | "out"): void {
    this.zoomBy(direction === "in" ? -CAMERA_BUTTON_ZOOM_DELTA : CAMERA_BUTTON_ZOOM_DELTA);
  }

  reset(): void {
    if (this.drag) this.finishDrag(this.drag.pointerId);
    this.rig.reset();
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== "mouse" || (e.button !== 0 && e.button !== 1) || this.drag) return;
    if (!this.groundPoint(e.clientX, e.clientY, this.pointA)) return;
    if (!this.groundPoint(e.clientX + 1, e.clientY, this.pointB)) return;
    if (!this.groundPoint(e.clientX, e.clientY + 1, this.pointC)) return;

    this.drag = {
      pointerId: e.pointerId,
      button: e.button,
      startX: e.clientX,
      startY: e.clientY,
      startOffset: this.rig.currentOffset(new THREE.Vector3()),
      worldPerPixelX: this.pointB.clone().sub(this.pointA),
      worldPerPixelY: this.pointC.clone().sub(this.pointA),
      dragging: e.button === 1,
    };
    // Capture immediately, even before the left-drag threshold. Otherwise a
    // press begun beside a HUD edge can leave the canvas and release unseen,
    // stranding this.drag and blocking every later gesture.
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
    if (e.button === 1) {
      e.preventDefault();
      this.canvas.classList.add("camera-dragging");
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const buttonMask = drag.button === 0 ? 1 : 4;
    if ((e.buttons & buttonMask) === 0) {
      this.finishDrag(e.pointerId);
      return;
    }
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.dragging && Math.hypot(dx, dy) < CAMERA_DRAG_THRESHOLD) return;
    if (!drag.dragging) {
      drag.dragging = true;
      this.canvas.classList.add("camera-dragging");
    }

    // Grab-to-pan: moving the pointer right pulls the world right, so the
    // camera focus moves by the opposite ground-plane delta.
    this.nextOffset.copy(drag.startOffset)
      .addScaledVector(drag.worldPerPixelX, -dx)
      .addScaledVector(drag.worldPerPixelY, -dy);
    this.rig.setOffset(this.nextOffset, this.anchor);
    e.preventDefault();
  }

  private onPointerUp(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.dragging) {
      e.preventDefault();
      if (drag.button === 0) {
        this.suppressedClick = { x: e.clientX, y: e.clientY, until: performance.now() + 500 };
        // The browser-generated click follows pointerup in the same input task.
        // If a synthetic environment omits it, expire before a later genuine
        // click instead of swallowing the user's next action.
        if (this.suppressTimer !== null) window.clearTimeout(this.suppressTimer);
        this.suppressTimer = window.setTimeout(() => {
          this.suppressedClick = null;
          this.suppressTimer = null;
        }, 0);
      }
    }
    this.finishDrag(e.pointerId);
  }

  private onPointerCancel(e: PointerEvent): void {
    if (this.drag?.pointerId === e.pointerId) this.finishDrag(e.pointerId);
  }

  private onLostPointerCapture(e: PointerEvent): void {
    if (this.drag?.pointerId === e.pointerId) this.finishDrag(e.pointerId, false);
  }

  /** Consume only the click synthesized by a completed left drag. */
  private onClickCapture(e: MouseEvent): void {
    const blocked = this.suppressedClick;
    if (!blocked) return;
    this.suppressedClick = null;
    if (this.suppressTimer !== null) {
      window.clearTimeout(this.suppressTimer);
      this.suppressTimer = null;
    }
    if (performance.now() > blocked.until || Math.hypot(e.clientX - blocked.x, e.clientY - blocked.y) > 12) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  private onAuxClick(e: MouseEvent): void {
    if (e.button === 1) e.preventDefault();
  }

  private onWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey || e.defaultPrevented) return;
    const delta = wheelPixels(e.deltaY, e.deltaMode, this.canvas.clientHeight || window.innerHeight);
    if (delta === 0) return;
    e.preventDefault();
    this.zoomBy(delta);
  }

  private onWindowBlur(): void {
    if (this.drag) this.finishDrag(this.drag.pointerId);
  }

  private groundPoint(clientX: number, clientY: number, out: THREE.Vector3): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.camera.updateMatrixWorld(true);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray.intersectPlane(this.ground, out);
  }

  private finishDrag(pointerId: number, releaseCapture = true): void {
    this.drag = null;
    this.canvas.classList.remove("camera-dragging");
    if (!releaseCapture) return;
    try {
      if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    } catch { /* capture may already have been released by the browser */ }
  }

  dispose(): void {
    if (this.drag) this.finishDrag(this.drag.pointerId);
    if (this.suppressTimer !== null) window.clearTimeout(this.suppressTimer);
    this.suppressTimer = null;
    this.suppressedClick = null;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("lostpointercapture", this.onLostPointerCapture);
    this.canvas.removeEventListener("click", this.onClickCapture, true);
    this.canvas.removeEventListener("auxclick", this.onAuxClick);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("blur", this.onWindowBlur);
  }
}
