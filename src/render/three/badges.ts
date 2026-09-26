/* ============================================================================
   Fault badges — a small dark pill above any building that isn't running,
   naming why: NO POWER, DAMAGED, FLARE FAULT, NO SEAL, NO CREW, NO WATER, NO
   OXYGEN, NO FOOD. Corridors are excluded, so a brownout does not badge every
   corridor cell — the existing per-building status light already covers that.

   Mirrors nametags.ts: a pooled THREE.Sprite billboard system backed by a
   CanvasTexture drawn lazily and cached per label, unlit + no depth test so a
   dome never eats a badge, bottom-anchored above the roof. All canvas/DOM
   work lives inside methods (never at import time or the constructor), for
   node-test safety — tests inject a stub texture factory instead. Render-
   layer only: it reads offReason off the snapshot's buildings, never the
   engine.
   ============================================================================ */
import * as THREE from "three";
import type { BuildingState, OffReason } from "@shared/types";
import { DEFS } from "@/engine";

/** the pill text for each reason a building recorded on its last tick */
export const OFF_REASON_LABEL: Record<OffReason, string> = {
  power: "NO POWER",
  damaged: "DAMAGED",
  faulted: "FLARE FAULT",
  seal: "NO SEAL",
  crew: "NO CREW",
  water: "NO WATER",
  oxygen: "NO OXYGEN",
  food: "NO FOOD",
};

export interface BadgeSpec { uid: number; label: string }

/** one badge per building that recorded an offReason, skipping conduits
 *  (corridors) so a brownout does not badge every corridor cell. */
export function badgeSpecs(buildings: readonly BuildingState[]): BadgeSpec[] {
  const specs: BadgeSpec[] = [];
  for (const b of buildings) {
    if (!b.offReason) continue;
    if (DEFS[b.defId]?.conduit) continue;
    specs.push({ uid: b.uid, label: OFF_REASON_LABEL[b.offReason] });
  }
  return specs;
}

export type BadgeTextureFactory = (label: string) => THREE.Texture;

const FONT = '600 34px "IBM Plex Mono", ui-monospace, monospace'; // bold: it reads at ~15px tall
const PANEL = "rgba(12, 16, 20, 0.82)";
const INK = "#e8784f";
const HAIR = "rgba(232, 120, 79, 0.55)";

const TEX_H = 64; // canvas height (authored at ~2x for crispness)
const PAD = 16;

/** world height of a badge at scale 1 (the renderer's overview zoom): about
 *  15px on an 800px-tall view. setScale keeps that on-screen size at any zoom. */
const BADGE_H = 0.5;
const ANCHOR_LIFT = 0.12; // above the anchor point (the roof height)
/** fallback aspect for a texture with neither recorded dimensions nor an
 *  image to measure — the test stub `() => new THREE.Texture()` has both. */
const DEFAULT_ASPECT = 3.2;

/** Default factory: draws a dark pill with the fault label. Canvas work
 *  happens here, lazily, never at import time. The canvas size is stashed on
 *  the texture's userData so the class can size the sprite without touching
 *  the DOM again. */
function drawBadge(label: string): THREE.Texture {
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = FONT;
  const w = Math.ceil(measure.measureText(label).width) + PAD * 2;

  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = TEX_H;
  const ctx = cv.getContext("2d")!;
  const r = 11;
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, TEX_H - 2, r);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = HAIR;
  ctx.stroke();
  ctx.font = FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = INK;
  ctx.fillText(label, w / 2, TEX_H / 2 + 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; // canvas colours are sRGB, as in bubbles.ts
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter; // NPOT-safe, no mipmaps
  tex.userData.badgeWidth = w;
  tex.userData.badgeHeight = TEX_H;
  return tex;
}

/** the aspect ratio to size a sprite from: the factory's recorded canvas
 *  size, else the texture image's own size, else DEFAULT_ASPECT (the stub
 *  texture used in tests has neither). */
function aspectOf(tex: THREE.Texture): number {
  const w = tex.userData.badgeWidth as number | undefined;
  const h = tex.userData.badgeHeight as number | undefined;
  if (w && h) return w / h;
  const img = tex.image as { width?: number; height?: number } | null;
  if (img && img.width && img.height) return img.width / img.height;
  return DEFAULT_ASPECT;
}

interface Slot { sprite: THREE.Sprite; label: string | null }

export class FaultBadgeSystem {
  readonly group = new THREE.Group();

  private makeTexture: BadgeTextureFactory;
  /** index-based pool: reused by position, not by uid, so a shrinking specs
   *  list hides the tail instead of destroying sprites. */
  private pool: Slot[] = [];
  /** lazy texture cache keyed by label — each drawn exactly once */
  private textures = new Map<string, THREE.Texture>();
  /** the specs+anchors key from the last sync; an unchanged call is a no-op */
  private lastKey = "";
  /** size multiplier from setScale */
  private scale = 1;

  constructor(makeTexture?: BadgeTextureFactory) {
    this.group.name = "faultbadges";
    this.makeTexture = makeTexture ?? drawBadge;
  }

  /** One sprite per spec, positioned at anchor(uid) + (0, 0.12, 0); a spec
   *  whose anchor is null is skipped. Sprites beyond what this call shows are
   *  hidden, not removed, so they are ready to reuse next time. Cheap when
   *  nothing changed: a key built from the specs and rounded anchor
   *  positions short-circuits before any sprite is touched. */
  sync(specs: readonly BadgeSpec[], anchor: (uid: number) => THREE.Vector3 | null): void {
    const resolved: { label: string; pos: THREE.Vector3 }[] = [];
    const parts: string[] = [];
    for (const spec of specs) {
      const pos = anchor(spec.uid);
      if (pos) {
        resolved.push({ label: spec.label, pos });
        parts.push(`${spec.uid}:${spec.label}:${pos.x.toFixed(3)},${pos.y.toFixed(3)},${pos.z.toFixed(3)}`);
      } else {
        parts.push(`${spec.uid}:${spec.label}:-`);
      }
    }
    const key = parts.join("|");
    if (key === this.lastKey) return;
    this.lastKey = key;

    let shown = 0;
    for (const { label, pos } of resolved) {
      const slot = this.slot(shown);
      this.paint(slot, label);
      slot.sprite.position.set(pos.x, pos.y + ANCHOR_LIFT, pos.z);
      slot.sprite.visible = true;
      shown++;
    }
    for (let i = shown; i < this.pool.length; i++) this.pool[i].sprite.visible = false;
  }

  /** Multiply every badge's size by k. The renderer passes the camera's view
   *  over its overview view, so a badge keeps its on-screen size as the camera
   *  zooms. A call that barely changes k does nothing. */
  setScale(k: number): void {
    if (Math.abs(k - this.scale) < 1e-4) return;
    this.scale = k;
    for (const slot of this.pool) if (slot.label !== null) this.size(slot);
  }

  private slot(i: number): Slot {
    let slot = this.pool[i];
    if (!slot) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        transparent: true, depthWrite: false, depthTest: false,
      }));
      sprite.center.set(0.5, 0); // bottom-anchored: grows upward off the roof
      sprite.renderOrder = 999;
      this.group.add(sprite);
      slot = { sprite, label: null };
      this.pool[i] = slot;
    }
    return slot;
  }

  private paint(slot: Slot, label: string): void {
    if (slot.label === label) return;
    const tex = this.texture(label);
    const mat = slot.sprite.material as THREE.SpriteMaterial;
    mat.map = tex;
    mat.needsUpdate = true;
    slot.label = label;
    this.size(slot);
  }

  /** height from the scale, width from the label texture's aspect */
  private size(slot: Slot): void {
    const h = BADGE_H * this.scale;
    slot.sprite.scale.set(h * aspectOf((slot.sprite.material as THREE.SpriteMaterial).map!), h, 1);
  }

  private texture(label: string): THREE.Texture {
    const cached = this.textures.get(label);
    if (cached) return cached;
    const tex = this.makeTexture(label);
    this.textures.set(label, tex);
    return tex;
  }

  dispose(): void {
    for (const slot of this.pool) {
      this.group.remove(slot.sprite);
      (slot.sprite.material as THREE.SpriteMaterial).dispose();
    }
    for (const tex of this.textures.values()) tex.dispose();
    this.pool = [];
    this.textures.clear();
    this.lastKey = "";
  }
}
