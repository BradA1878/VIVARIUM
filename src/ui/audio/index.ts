/* ============================================================================
   The audio engine — a module singleton the colony store subscribes to the
   bridge (one more observer; doc §0 — sound is pure observation, zero assets).

   Lifecycle: initAudio() only attaches capture-phase pointerdown/keydown
   listeners (the Boot overlay auto-dismisses, so a gesture is NOT guaranteed
   early); the AudioContext is constructed on the first gesture and resume() is
   retried on every later one until it actually runs (Safari). If Web Audio is
   missing or construction throws, every public method is a permanent no-op —
   the game never depends on sound.

   Graph:  one-shots → sfx ─┐
           AmbientBed → ambient ─┼→ master → destination
           victory/defeat themes ┘   (themes ride master; buses duck under them)

   The PURE decisions (event→cue, snapshot→ambience, snapshot diff) live in
   map.ts where vitest can reach them; this file is only plumbing + recipes.
   ============================================================================ */
import type { ColonyEvent, Snapshot } from "@shared/types";
import {
  CUE_MIN_GAP_MS, EVENT_CUES, cellKey, deriveState, diffSnapshot, miniOf,
  type AmbientState, type CueId, type SnapMini,
} from "./map";
import { chord, noiseHit, tone } from "./synth";
import { AmbientBed } from "./ambient";

/** structurally matches Settings["audio"] without importing the store */
export interface AudioLevels {
  master: number;
  sfx: number;
  ambient: number;
  muted: boolean;
}

/** how long a building_destroyed cell suppresses the diff's demolish thunk */
const DESTROYED_TTL_MS = 4000;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambientBus: GainNode | null = null;
  private bed = new AmbientBed();

  private listening = false;
  private unlocked = false;
  /** Web Audio unavailable / construction threw — permanent no-op */
  private failed = false;

  private levels: AudioLevels = { master: 0.8, sfx: 0.9, ambient: 0.7, muted: false };
  private lastAmbient: AmbientState | null = null;
  private prevMini: SnapMini | null = null;
  /** cell key → when it was hazard-destroyed (suppresses the demolish thunk) */
  private recentlyDestroyed = new Map<string, number>();

  /** per-cue throttle clock + the DEV observability ring */
  private lastAt = new Map<CueId, number>();
  private ring: { id: CueId; at: number }[] = [];

  private suspendTimer: number | null = null;
  /** pending one-shot tail cleanups (echo nodes etc.) */
  private tails = new Set<number>();

  // ---- lifecycle -------------------------------------------------------------

  /** attach the unlock + visibility listeners. Idempotent; touches no Web Audio. */
  init(): void {
    if (this.listening || typeof window === "undefined") return;
    this.listening = true;
    window.addEventListener("pointerdown", this.unlock, true);
    window.addEventListener("keydown", this.unlock, true);
    document.addEventListener("visibilitychange", this.onVis);
  }

  /** first gesture constructs the context; later gestures keep nudging resume()
   *  until the context really runs (Safari can stay "suspended" for a while) */
  private unlock = (): void => {
    if (this.failed) return;
    if (!this.ctx) {
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (!AC) { this.failed = true; return; }
      try {
        this.ctx = new AC();
        this.buildGraph(this.ctx);
      } catch {
        this.ctx = null;
        this.failed = true;
        return;
      }
    }
    if (this.ctx.state !== "running") {
      void this.ctx.resume().then(() => { this.unlocked = true; }).catch(() => {});
    } else this.unlocked = true;
  };

  private buildGraph(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = this.masterTarget();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.levels.sfx ** 2;
    this.sfx.connect(this.master);
    this.ambientBus = ctx.createGain();
    this.ambientBus.gain.value = this.levels.ambient ** 2;
    this.ambientBus.connect(this.master);
    this.bed.start(ctx, this.ambientBus);
    this.applyAmbient(); // the colony may already be mid-storm when the gesture lands
  }

  private onVis = (): void => {
    if (!this.ctx || !this.master) return;
    if (document.hidden) {
      // fade out over ~0.3s, then park the context (the worker keeps ticking)
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      this.suspendTimer = window.setTimeout(() => {
        this.suspendTimer = null;
        void this.ctx?.suspend().catch(() => {});
      }, 300);
    } else {
      if (this.suspendTimer != null) { window.clearTimeout(this.suspendTimer); this.suspendTimer = null; }
      void this.ctx.resume().catch(() => {});
      this.master.gain.setTargetAtTime(this.masterTarget(), this.ctx.currentTime, 0.1);
    }
  };

  /** stop the beds, drop the listeners, close the context. Re-init is allowed. */
  dispose(): void {
    if (this.listening && typeof window !== "undefined") {
      window.removeEventListener("pointerdown", this.unlock, true);
      window.removeEventListener("keydown", this.unlock, true);
      document.removeEventListener("visibilitychange", this.onVis);
    }
    this.listening = false;
    if (this.suspendTimer != null) { window.clearTimeout(this.suspendTimer); this.suspendTimer = null; }
    for (const t of this.tails) window.clearTimeout(t);
    this.tails.clear();
    this.bed.stop();
    if (this.ctx) void this.ctx.close().catch(() => {});
    this.ctx = null;
    this.master = this.sfx = this.ambientBus = null;
    this.unlocked = false;
    this.failed = false;
    this.prevMini = null;
    this.lastAmbient = null;
    this.recentlyDestroyed.clear();
    this.lastAt.clear();
    this.ring.length = 0;
  }

  // ---- volumes ----------------------------------------------------------------

  /** perceptual taper — sliders feel linear when gain is v² */
  private masterTarget(): number {
    return this.levels.muted ? 0 : this.levels.master ** 2;
  }

  applySettings(a: AudioLevels): void {
    this.levels = { ...a };
    if (!this.ctx || !this.master || !this.sfx || !this.ambientBus) return;
    const now = this.ctx.currentTime;
    const hidden = typeof document !== "undefined" && document.hidden;
    this.master.gain.setTargetAtTime(hidden ? 0 : this.masterTarget(), now, 0.05);
    this.sfx.gain.setTargetAtTime(this.levels.sfx ** 2, now, 0.05);
    this.ambientBus.gain.setTargetAtTime(this.levels.ambient ** 2, now, 0.05);
  }

  // ---- the two bridge subscriptions ---------------------------------------------

  onEvent(e: ColonyEvent): void {
    // remember hazard kills even while locked/hidden — the demolish suppression
    // must stay correct regardless of when audio actually unlocks
    if (e.type === "building_destroyed" && e.gx != null && e.gy != null) {
      this.recentlyDestroyed.set(cellKey(e.gx, e.gy), performance.now());
    }
    if (typeof document !== "undefined" && document.hidden) return; // no one-shots in a background tab
    const id = EVENT_CUES[e.type]?.(e);
    if (id) this.cue(id);
  }

  onSnapshot(s: Snapshot): void {
    this.lastAmbient = deriveState(s);
    this.applyAmbient();
    // the diff baseline advances even while locked/hidden, so unlocking
    // mid-game never replays stale transitions
    const mini = miniOf(s);
    const cues = diffSnapshot(this.prevMini, mini, this.destroyedCells());
    this.prevMini = mini;
    if (typeof document !== "undefined" && document.hidden) return;
    for (const id of cues) this.cue(id);
  }

  private applyAmbient(): void {
    const a = this.lastAmbient;
    if (!a || !this.ctx) return;
    this.bed.setWind(a.wind, a.stormy);
    this.bed.setHum(a.hum);
    this.bed.setDread(a.dread);
    this.bed.setRumble(a.rumble);
  }

  private destroyedCells(): ReadonlySet<string> | undefined {
    if (this.recentlyDestroyed.size === 0) return undefined;
    const cutoff = performance.now() - DESTROYED_TTL_MS;
    for (const [k, at] of this.recentlyDestroyed) if (at < cutoff) this.recentlyDestroyed.delete(k);
    return new Set(this.recentlyDestroyed.keys());
  }

  // ---- playing -----------------------------------------------------------------

  private ready(): boolean {
    return !this.failed && !!this.ctx && this.ctx.state === "running" && !!this.sfx && !!this.master;
  }

  /** play a cue now (throttled). Public so the store can blip UI interactions
   *  and Playwright can audition any cue via window.__viv.audio. */
  cue(id: CueId): void {
    if (!this.ready()) return;
    const now = performance.now();
    const last = this.lastAt.get(id);
    if (last != null && now - last < CUE_MIN_GAP_MS[id]) return;
    this.lastAt.set(id, now);
    this.ring.push({ id, at: now });
    if (this.ring.length > 20) this.ring.shift();
    this.playCue(id);
  }

  /** the tiny interface blip for pick/rotate/demolish-mode clicks */
  uiTick(): void {
    this.cue("uiTick");
  }

  // ---- DEV observability ----------------------------------------------------------

  /** the last ≤20 cues played, for Playwright assertions */
  lastPlayed(): readonly { id: CueId; at: number }[] {
    return this.ring.slice();
  }

  engineState(): { unlocked: boolean; ctxState: string } {
    return {
      unlocked: this.unlocked,
      ctxState: this.ctx?.state ?? (this.failed ? "unavailable" : "uninitialized"),
    };
  }

  // ---- the recipes -----------------------------------------------------------------

  private playCue(id: CueId): void {
    const ctx = this.ctx!;
    const sfx = this.sfx!;
    switch (id) {
      case "uiTick": // dry interface click
        tone(ctx, sfx, { type: "square", f0: 1250, dur: 0.03, gain: 0.045, filter: { type: "highpass", freq: 600 } });
        break;
      case "place": // an up-blip + the thump of setting something down
        tone(ctx, sfx, { type: "triangle", f0: 520, f1: 700, dur: 0.09, gain: 0.14 });
        noiseHit(ctx, sfx, { dur: 0.08, gain: 0.1, filter: { type: "lowpass", freq: 420 } });
        break;
      case "demolish": // a crunch falling away
        noiseHit(ctx, sfx, { dur: 0.16, gain: 0.2, filter: { type: "lowpass", freq: 300 } });
        tone(ctx, sfx, { type: "sawtooth", f0: 220, f1: 90, dur: 0.16, gain: 0.1 });
        break;
      case "pickup": // chirp up
        tone(ctx, sfx, { type: "triangle", f0: 660, f1: 920, dur: 0.07, gain: 0.11 });
        break;
      case "drop": // thunk down at the depot
        tone(ctx, sfx, { type: "triangle", f0: 420, f1: 240, dur: 0.1, gain: 0.12 });
        noiseHit(ctx, sfx, { dur: 0.07, gain: 0.08, filter: { type: "lowpass", freq: 350 } });
        break;
      case "alertWarn": // two rising sines — the console clearing its throat
        tone(ctx, sfx, { type: "sine", f0: 520, f1: 780, dur: 0.16, gain: 0.12 });
        tone(ctx, sfx, { type: "sine", f0: 520, f1: 780, dur: 0.16, gain: 0.12, delay: 0.22 });
        break;
      case "hazardStart": // a low whomp as the wall arrives
        noiseHit(ctx, sfx, { dur: 0.5, gain: 0.22, filter: { type: "lowpass", freq: 500 } });
        tone(ctx, sfx, { type: "sine", f0: 220, f1: 70, dur: 0.55, gain: 0.16 });
        break;
      case "hazardEnd": // soft relief, rising
        tone(ctx, sfx, { type: "sine", f0: 392, f1: 523.25, dur: 0.18, gain: 0.09 });
        tone(ctx, sfx, { type: "sine", f0: 523.25, f1: 659.25, dur: 0.22, gain: 0.08, delay: 0.16 });
        break;
      case "brownout": // power sagging
        tone(ctx, sfx, { type: "triangle", f0: 440, f1: 120, dur: 0.4, gain: 0.14 });
        break;
      case "powerBack": // and returning
        tone(ctx, sfx, { type: "triangle", f0: 120, f1: 440, dur: 0.4, gain: 0.12 });
        break;
      case "critPulse": // 3×70ms squares — the life-support alarm
        for (let i = 0; i < 3; i++) {
          tone(ctx, sfx, { type: "square", f0: 660, dur: 0.07, gain: 0.09, delay: i * 0.14, filter: { type: "lowpass", freq: 2200 } });
        }
        break;
      case "casualtyDrone": // two detuned sines beating against each other
        tone(ctx, sfx, { type: "sine", f0: 110, dur: 1.4, gain: 0.16, filter: { type: "lowpass", freq: 600 } });
        tone(ctx, sfx, { type: "sine", f0: 113, dur: 1.4, gain: 0.16, filter: { type: "lowpass", freq: 600 } });
        break;
      case "chimeUp": // 3-note pentatonic arp — good news
        chord(ctx, sfx, [
          { f: 523.25, at: 0, dur: 0.14, type: "triangle", gain: 0.1 },
          { f: 659.25, at: 0.09, dur: 0.14, type: "triangle", gain: 0.1 },
          { f: 783.99, at: 0.18, dur: 0.24, type: "triangle", gain: 0.1 },
        ]);
        break;
      case "tradeMotif": { // D5 F5 C5 E5 with vibrato — curious, not of this world
        const notes = [587.33, 698.46, 523.25, 659.25];
        notes.forEach((f, i) => tone(ctx, sfx, {
          type: "triangle", f0: f, dur: 0.2, gain: 0.09, delay: i * 0.17, vib: { f: 6, depth: 9 },
        }));
        break;
      }
      case "tradeDone": // the till closing
        tone(ctx, sfx, { type: "triangle", f0: 660, dur: 0.09, gain: 0.1 });
        tone(ctx, sfx, { type: "triangle", f0: 990, dur: 0.14, gain: 0.1, delay: 0.1 });
        break;
      case "ufoSweep": // the saucer descends
        tone(ctx, sfx, { type: "sawtooth", f0: 220, f1: 80, dur: 0.8, gain: 0.12, filter: { type: "lowpass", freq: 900 } });
        break;
      case "abductSting": // someone goes up
        tone(ctx, sfx, { type: "sawtooth", f0: 440, f1: 1760, dur: 0.5, gain: 0.1, filter: { type: "lowpass", freq: 2600 } });
        break;
      case "deflectZap": // the beam glances off
        tone(ctx, sfx, { type: "square", f0: 1200, dur: 0.2, gain: 0.09, trem: { f: 20, depth: 0.09 }, filter: { type: "bandpass", freq: 1200, q: 2 } });
        break;
      case "destroyed": // structural loss
        noiseHit(ctx, sfx, { dur: 0.4, gain: 0.32, filter: { type: "bandpass", freq: 260, q: 1.1 } });
        tone(ctx, sfx, { type: "sawtooth", f0: 160, f1: 60, dur: 0.45, gain: 0.16 });
        break;
      case "resupplyHorn": // the lander's dyad
        tone(ctx, sfx, { type: "triangle", f0: 330, dur: 0.6, gain: 0.11 });
        tone(ctx, sfx, { type: "triangle", f0: 440, dur: 0.6, gain: 0.11 });
        break;
      case "victoryTheme":
        this.victory(ctx);
        break;
      case "defeatTheme":
        this.defeat(ctx);
        break;
    }
  }

  /** pull the sfx/ambient buses down to 0.2× and let them drift back later —
   *  the campaign themes get the room to themselves */
  private duck(holdS: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const buses: [GainNode | null, number][] = [
      [this.sfx, this.levels.sfx ** 2],
      [this.ambientBus, this.levels.ambient ** 2],
    ];
    for (const [bus, v] of buses) {
      if (!bus) continue;
      bus.gain.setTargetAtTime(v * 0.2, now, 0.15);
      bus.gain.setTargetAtTime(v, now + holdS, 1.2);
    }
  }

  /** a temporary theme bus straight into master (it rides above the duck) */
  private themeBus(ctx: AudioContext, ttlMs: number): GainNode | null {
    if (!this.master) return null;
    const out = ctx.createGain();
    out.connect(this.master);
    this.tail(() => out.disconnect(), ttlMs);
    return out;
  }

  private victory(ctx: AudioContext): void {
    const out = this.themeBus(ctx, 8000);
    if (!out) return;
    this.duck(4.5);
    // a feedback echo — the resolve hangs in the thin air
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.22;
    const fb = ctx.createGain();
    fb.gain.value = 0.25;
    delay.connect(fb).connect(delay);
    delay.connect(out);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    send.connect(out);
    send.connect(delay);
    this.tail(() => { delay.disconnect(); fb.disconnect(); send.disconnect(); }, 8000);
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51]; // C5 E5 G5 C6 E6 — a major resolve
    notes.forEach((f, i) => tone(ctx, send, {
      type: "triangle", f0: f, dur: i === notes.length - 1 ? 0.7 : 0.22, gain: 0.12, delay: i * 0.21,
    }));
  }

  private defeat(ctx: AudioContext): void {
    const out = this.themeBus(ctx, 6000);
    if (!out) return;
    this.duck(5);
    const notes = [220, 164.81, 130.81, 110]; // A3 E3 C3 A2 — a minor descent, ~2.5s
    notes.forEach((f, i) => tone(ctx, out, {
      type: "triangle", f0: f, dur: 0.75, gain: 0.13, delay: i * 0.58, filter: { type: "lowpass", freq: 520 },
    }));
  }

  private tail(fn: () => void, ms: number): void {
    if (typeof window === "undefined") return;
    const t = window.setTimeout(() => {
      this.tails.delete(t);
      try { fn(); } catch { /* nodes already gone */ }
    }, ms);
    this.tails.add(t);
  }
}

/** the singleton — constructed eagerly (touches nothing), unlocked lazily */
export const audio = new AudioEngine();

/** attach the gesture/visibility listeners (called once from initColony) */
export function initAudio(): void {
  audio.init();
}
