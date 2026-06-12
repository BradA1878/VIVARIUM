/* ============================================================================
   Reaction bubbles — tiny comic chips above colonists' heads, so the crew
   visibly REACTS: "!" when they break for shelter, "+" limping to the medbay,
   a gear setting off to work, "z" heading home at night, and one-shot words
   ("storm!", "ouch", "taken!") routed from ColonyEvents by the renderer.

   A pooled THREE.Sprite billboard system: each chip is a CanvasTexture (a
   rounded HUD-tone panel + a hair border + a mono glyph/word, cyan default /
   rust for alarm), generated LAZILY and cached per glyph|tone — zero per-frame
   canvas work. Sprites always face the camera; materials are plain unlit
   sprites with texture values ≤ 1.0, so they sit safely under the bloom
   threshold (no blowout). Noise rules live here: max 4 concurrent, a 6s
   per-colonist cooldown, and the possessed colonist never bubbles (the player
   IS that colonist — narrating them is noise).

   Render-layer only; all DOM/canvas work happens inside methods, never at
   import time (node-test safety).
   ============================================================================ */
import * as THREE from "three";
import type { ColonistAct } from "@shared/types";

export type BubbleTone = "cyan" | "rust";

/** map a colonist's NEW state to its reaction chip (null = no reaction).
 *  toHome only reads as "going to sleep" when the scene is actually dark. */
export function reactionFor(state: ColonistAct, night: number): [string, BubbleTone] | null {
  switch (state) {
    case "sheltering": return ["!", "rust"];
    case "toMedbay": return ["+", "rust"];
    case "recovering": return ["+", "cyan"];
    case "toWork": return ["⚙", "cyan"];
    case "mining": return ["*", "cyan"];
    case "toHome": return night > 0.5 ? ["z", "cyan"] : null;
    default: return null;
  }
}

// ---- noise rules -------------------------------------------------------------
const MAX_CONCURRENT = 4;
const COOLDOWN_MS = 6000;

// ---- lifetime / motion ---------------------------------------------------------
const LIFE = 2.5; // seconds on screen
const FADE_IN = 0.18; // quick in...
const FADE_OUT = 0.45; // ...gentle out
const DRIFT = 0.09; // world units/s of upward drift
/** chip anchor height above the feet — ≈ 1.15 at the astronaut's 0.55 figure scale.
 *  The sprite is BOTTOM-anchored here (sprite.center y = 0), so the panel grows
 *  upward and never covers the helmet. */
const HEAD_Y = 0.63;
// sprite footprint in world units (3:2). Sized to stay readable from the
// OVERVIEW camera (view 13 ≈ 30 px/unit) — bubbles are a spectator signal, the
// possessed colonist never shows one, so the wide shot is the one that counts.
const CHIP_W = 0.9;
const CHIP_H = 0.6;

// ---- chip canvas (the ~96×64 design, authored at 2× for crispness) ------------
const TEX_W = 192;
const TEX_H = 128;
/** the HUD mono (tokens.css --mono) */
const FONT = '"IBM Plex Mono", ui-monospace, monospace';
/** the --panel dark tone, slightly denser so chips read over bright terrain */
const PANEL = "rgba(12, 16, 20, 0.88)";
const TONE_INK: Record<BubbleTone, string> = { cyan: "#7fd4e8", rust: "#c8794f" };
const TONE_HAIR: Record<BubbleTone, string> = {
  cyan: "rgba(127, 212, 232, 0.3)",
  rust: "rgba(200, 121, 79, 0.38)",
};

interface Bubble {
  sprite: THREE.Sprite;
  /** a LIVE reference (the renderer's lerped rec.pos) — the chip rides along */
  anchor: THREE.Vector3;
  age: number;
  /** extra height when spawned over an anchor that already has a live chip
   *  nearby — neighbours stack comic-strip style instead of overlapping */
  lift: number;
}

export class BubbleSystem {
  readonly group = new THREE.Group();

  private live: Bubble[] = [];
  private free: THREE.Sprite[] = [];
  /** lazy chip cache, keyed `${tone}|${text}` — each texture drawn exactly once */
  private chips = new Map<string, THREE.CanvasTexture>();
  /** per-colonist cooldown clock (ms timestamps) */
  private lastAt = new Map<number, number>();
  private possessed: number | null = null;
  /** does "⚙" actually render in the mono stack? probed once, lazily */
  private gearOk: boolean | null = null;

  constructor() {
    this.group.name = "bubbles";
  }

  /** the piloted colonist never bubbles — the renderer re-asserts this each frame */
  setPossessed(id: number | null): void {
    this.possessed = id;
  }

  /** could `id` show a chip right now? Event-word picks ask BEFORE choosing a
   *  speaker, so a colony-level call ("storm!", "taken!") lands on a colonist
   *  who is actually free instead of being swallowed by one on cooldown. */
  available(id: number, now: number): boolean {
    if (id === this.possessed) return false;
    if (this.live.length >= MAX_CONCURRENT) return false;
    const last = this.lastAt.get(id);
    return last === undefined || now - last >= COOLDOWN_MS;
  }

  /** show a chip above `anchor` for colonist `id` — subject to the noise rules
   *  (change-only triggering is the CALLER's job; it knows the prior state). */
  spawn(id: number, anchor: THREE.Vector3, text: string, tone: BubbleTone, now: number): void {
    if (id === this.possessed) return;
    if (this.live.length >= MAX_CONCURRENT) return; // skip extras, don't queue
    const last = this.lastAt.get(id);
    if (last !== undefined && now - last < COOLDOWN_MS) return;
    this.lastAt.set(id, now);
    // keep the cooldown map tiny — expired entries are dead weight
    if (this.lastAt.size > 64) {
      for (const [k, t] of this.lastAt) if (now - t >= COOLDOWN_MS) this.lastAt.delete(k);
    }

    const tex = this.chip(text, tone);
    let sprite = this.free.pop();
    if (!sprite) {
      sprite = new THREE.Sprite(
        // unlit, no depth test: a speech chip must never vanish behind a dome
        new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }),
      );
      sprite.center.set(0.5, 0); // bottom-anchored: the chip grows upward off the head
      sprite.renderOrder = 5;
      this.group.add(sprite);
    }
    const mat = sprite.material as THREE.SpriteMaterial;
    if (mat.map !== tex) {
      mat.map = tex;
      mat.needsUpdate = true;
    }
    mat.opacity = 0;
    // colonists walk shoulder to shoulder — stack a newcomer's chip above any
    // live chip already floating over (almost) the same spot
    let lift = 0;
    for (const b of this.live) {
      const dx = b.anchor.x - anchor.x;
      const dz = b.anchor.z - anchor.z;
      if (dx * dx + dz * dz < 0.45 * 0.45) lift = Math.max(lift, b.lift + CHIP_H * 1.12);
    }
    sprite.scale.set(CHIP_W, CHIP_H, 1);
    sprite.position.set(anchor.x, anchor.y + HEAD_Y + lift, anchor.z);
    sprite.visible = true;
    this.live.push({ sprite, anchor, age: 0, lift });
  }

  /** advance fades + drift; retire finished chips back into the pool */
  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i];
      b.age += dt;
      if (b.age >= LIFE) {
        b.sprite.visible = false;
        this.free.push(b.sprite);
        this.live.splice(i, 1);
        continue;
      }
      const inK = Math.min(1, b.age / FADE_IN);
      const outK = Math.min(1, (LIFE - b.age) / FADE_OUT);
      (b.sprite.material as THREE.SpriteMaterial).opacity = Math.min(inK, outK) * 0.96;
      // ride the colonist (live anchor) + drift gently upward as it ages
      b.sprite.position.set(b.anchor.x, b.anchor.y + HEAD_Y + b.lift + DRIFT * b.age, b.anchor.z);
      // a whisper of scale-in so the pop doesn't feel like a hard cut
      const s = 0.85 + 0.15 * (1 - (1 - inK) * (1 - inK));
      b.sprite.scale.set(CHIP_W * s, CHIP_H * s, 1);
    }
  }

  dispose(): void {
    for (const b of this.live) (b.sprite.material as THREE.SpriteMaterial).dispose();
    for (const s of this.free) (s.material as THREE.SpriteMaterial).dispose();
    this.live = [];
    this.free = [];
    for (const tex of this.chips.values()) tex.dispose();
    this.chips.clear();
    this.lastAt.clear();
    this.group.clear();
    this.group.removeFromParent();
  }

  // ---- chip factory ----------------------------------------------------------

  private chip(text: string, tone: BubbleTone): THREE.CanvasTexture {
    const key = `${tone}|${text}`;
    const cached = this.chips.get(key);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    const ctx = canvas.getContext("2d")!;
    const ink = TONE_INK[tone];

    // rounded panel + 1px hair border (2px strokes at the 2× authoring scale)
    roundedRect(ctx, 3, 3, TEX_W - 6, TEX_H - 6, 14);
    ctx.fillStyle = PANEL;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = TONE_HAIR[tone];
    ctx.stroke();

    if (text === "⚙" && !this.gearRenders()) {
      // the mono stack has no gear glyph here — draw the shape ourselves
      drawGear(ctx, TEX_W / 2, TEX_H / 2, 30, ink);
    } else {
      ctx.fillStyle = ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (text.length <= 1) {
        ctx.font = `600 64px ${FONT}`;
        // the asterisk hangs high in mono fonts — recenter it optically
        ctx.fillText(text, TEX_W / 2, TEX_H / 2 + (text === "*" ? 16 : 4));
      } else {
        let px = 44;
        ctx.font = `600 ${px}px ${FONT}`;
        const maxW = TEX_W - 32;
        const w = ctx.measureText(text).width;
        if (w > maxW) {
          px = Math.floor((px * maxW) / w);
          ctx.font = `600 ${px}px ${FONT}`;
        }
        ctx.fillText(text, TEX_W / 2, TEX_H / 2 + 2);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    this.chips.set(key, tex);
    return tex;
  }

  /** the quick canvas probe: render "⚙" and compare against a known-missing
   *  glyph and a blank — identical ink means tofu, so fall back to the drawn
   *  gear. Probed once, then cached. */
  private gearRenders(): boolean {
    if (this.gearOk !== null) return this.gearOk;
    const probe = (ch: string): string => {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      const x = c.getContext("2d")!;
      x.font = `28px ${FONT}`;
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.fillStyle = "#fff";
      x.fillText(ch, 16, 16);
      return c.toDataURL();
    };
    const gear = probe("⚙");
    this.gearOk = gear !== probe("\uFFFE") && gear !== probe(" ");
    return this.gearOk;
  }
}

/** manual rounded rect — avoids relying on CanvasPath.roundRect availability */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** the drawn-shape gear fallback: a stroked ring with eight stubby teeth */
function drawGear(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.rotate(a);
    ctx.fillRect(-r * 0.18, -r * 0.16, r * 0.36, r * 0.32);
    ctx.restore();
  }
  ctx.lineWidth = r * 0.42;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
