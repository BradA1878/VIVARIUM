/* ============================================================================
   Name tags — a player's callsign floating above the astronaut they drive, so
   co-op feels populated (multiplayer presence, Phase 3). One billboard sprite per
   named, present colonist; the local player's own tag reads in the green co-op
   accent, teammates in cyan.

   Mirrors the reaction-bubble system: a pooled THREE.Sprite billboard backed by a
   lazily-drawn CanvasTexture (cached per name|accent), bottom-anchored above the
   head, unlit + no depth test so a dome never eats a tag. All canvas/DOM work lives
   inside methods (never at import time) for node-test safety. Render-layer only —
   it reads the roster the host broadcasts, never the engine.
   ============================================================================ */
import * as THREE from "three";

const FONT = '"IBM Plex Mono", ui-monospace, monospace';
const PANEL = "rgba(12, 16, 20, 0.82)";
const MINE_INK = "#9bd6a0";
const MINE_HAIR = "rgba(155, 214, 160, 0.55)";
const PEER_INK = "#cfe6ee";
const PEER_HAIR = "rgba(127, 212, 232, 0.4)";

const HEAD_Y = 0.82;   // above the helmet (clears reaction chips at 0.63)
const TAG_H = 0.34;    // world height of the tag
const TEX_H = 64;      // canvas height (authored at ~2× for crispness)
const FONT_PX = 34;
const PAD = 16;

interface Tag { sprite: THREE.Sprite; name: string; mine: boolean }

export class NameTagSystem {
  readonly group = new THREE.Group();

  private tags = new Map<number, Tag>();
  /** lazy texture cache keyed `${mine}|${name}` — each drawn exactly once */
  private textures = new Map<string, THREE.CanvasTexture>();
  private names = new Map<number, string>();
  private mine: number | null = null;

  constructor() { this.group.name = "nametags"; }

  /** the actor→callsign map (from the host's roster) + which actor is local */
  setNames(names: Map<number, string>, mine: number | null): void {
    this.names = names;
    this.mine = mine;
  }

  /** position a tag above each named, present colonist; build/drop sprites to match */
  sync(colonists: Map<number, { pos: THREE.Vector3 }>): void {
    // drop tags whose actor is no longer named or no longer on the grid
    for (const [id, tag] of this.tags) {
      if (!this.names.has(id) || !colonists.has(id)) {
        this.group.remove(tag.sprite);
        this.tags.delete(id);
      }
    }
    for (const [id, name] of this.names) {
      const rec = colonists.get(id);
      if (!rec) continue;
      const mine = id === this.mine;
      let tag = this.tags.get(id);
      if (!tag || tag.name !== name || tag.mine !== mine) {
        if (tag) this.group.remove(tag.sprite);
        tag = this.build(name, mine);
        this.tags.set(id, tag);
      }
      tag.sprite.position.set(rec.pos.x, rec.pos.y + HEAD_Y, rec.pos.z);
      tag.sprite.visible = true;
    }
  }

  private build(name: string, mine: boolean): Tag {
    const tex = this.texture(name, mine);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: false,
    }));
    sprite.center.set(0.5, 0); // bottom-anchored: grows upward off the head
    sprite.renderOrder = 6;    // above reaction chips (5)
    const aspect = (tex.image as HTMLCanvasElement).width / TEX_H;
    sprite.scale.set(TAG_H * aspect, TAG_H, 1);
    this.group.add(sprite);
    return { sprite, name, mine };
  }

  private texture(name: string, mine: boolean): THREE.CanvasTexture {
    const key = `${mine ? 1 : 0}|${name}`;
    const cached = this.textures.get(key);
    if (cached) return cached;

    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = `${FONT_PX}px ${FONT}`;
    const w = Math.ceil(measure.measureText(name).width) + PAD * 2;

    const cv = document.createElement("canvas");
    cv.width = w; cv.height = TEX_H;
    const ctx = cv.getContext("2d")!;
    const r = 11;
    ctx.beginPath(); ctx.roundRect(1, 1, w - 2, TEX_H - 2, r);
    ctx.fillStyle = PANEL; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = mine ? MINE_HAIR : PEER_HAIR; ctx.stroke();
    ctx.font = `${FONT_PX}px ${FONT}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = mine ? MINE_INK : PEER_INK;
    ctx.fillText(name, w / 2, TEX_H / 2 + 2);

    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter; // NPOT-safe, no mipmaps
    this.textures.set(key, tex);
    return tex;
  }

  dispose(): void {
    for (const [, tag] of this.tags) {
      this.group.remove(tag.sprite);
      (tag.sprite.material as THREE.SpriteMaterial).dispose();
    }
    for (const [, tex] of this.textures) tex.dispose();
    this.tags.clear();
    this.textures.clear();
  }
}
