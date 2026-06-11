/* ============================================================================
   Synth helpers — tiny Web Audio building blocks every cue is made of. No
   assets, no samples: oscillators, one cached noise buffer, biquads, gains.
   Every voice is self-stopping and self-disconnecting (onended), so one-shots
   leave no nodes behind. Main-thread only — never imported by the engine, and
   never imported by map.ts (the unit-tested pure layer).
   ============================================================================ */

/** exponentialRampToValueAtTime cannot reach 0 — this is "silent" */
const FLOOR = 0.0001;

// ---- noise ------------------------------------------------------------------------

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** ~2s of white noise, generated once per context and reused by every consumer
 *  (the wind/rumble beds loop it; hits window into it). Math.random is fine
 *  here — this is the UI layer, far from the deterministic engine. */
export function noiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const hit = noiseCache.get(ctx);
  if (hit) return hit;
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

// ---- envelope -----------------------------------------------------------------------

export interface EnvOpts {
  /** attack seconds */
  a: number;
  /** decay seconds (after the attack) */
  d: number;
  /** level at the top of the attack */
  peak: number;
  /** level at the end of the decay (default: silent) */
  end?: number;
  /** absolute start time (ctx.currentTime-based) */
  at: number;
}

/** a-d envelope via exponential ramps (floored — exponential can't touch 0) */
export function env(param: AudioParam, o: EnvOpts): void {
  const a = Math.max(0.001, o.a);
  const d = Math.max(0.001, o.d);
  param.setValueAtTime(FLOOR, o.at);
  param.exponentialRampToValueAtTime(Math.max(FLOOR, o.peak), o.at + a);
  param.exponentialRampToValueAtTime(Math.max(FLOOR, o.end ?? FLOOR), o.at + a + d);
}

// ---- voices -----------------------------------------------------------------------

export interface FilterOpts {
  type: BiquadFilterType;
  freq: number;
  q?: number;
}

function makeFilter(ctx: BaseAudioContext, f: FilterOpts): BiquadFilterNode {
  const biq = ctx.createBiquadFilter();
  biq.type = f.type;
  biq.frequency.value = f.freq;
  if (f.q != null) biq.Q.value = f.q;
  return biq;
}

export interface ToneOpts {
  type: OscillatorType;
  /** start frequency */
  f0: number;
  /** glide target (exponential over dur) */
  f1?: number;
  dur: number;
  gain: number;
  /** seconds from now */
  delay?: number;
  filter?: FilterOpts;
  /** vibrato — an LFO into the oscillator frequency (depth in Hz) */
  vib?: { f: number; depth: number };
  /** tremolo — an LFO into the gain (depth 0..1) */
  trem?: { f: number; depth: number };
}

/** one enveloped oscillator: osc (→ filter) → gain → dest, self-stopping, all
 *  nodes disconnected onended. Returns the oscillator for callers that align
 *  other work to its lifetime. */
export function tone(ctx: BaseAudioContext, dest: AudioNode, o: ToneOpts): OscillatorNode {
  const t0 = ctx.currentTime + (o.delay ?? 0);
  const stopAt = t0 + o.dur + 0.08;

  const osc = ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(Math.max(1, o.f0), t0);
  if (o.f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur);

  const g = ctx.createGain();
  env(g.gain, { a: 0.008, d: o.dur, peak: o.gain, at: t0 });

  const extras: AudioNode[] = [];
  const lfos: OscillatorNode[] = [];
  const lfo = (f: number, depth: number, into: AudioParam): void => {
    const l = ctx.createOscillator();
    l.type = "sine";
    l.frequency.value = f;
    const dg = ctx.createGain();
    dg.gain.value = depth;
    l.connect(dg).connect(into);
    l.start(t0);
    l.stop(stopAt);
    lfos.push(l);
    extras.push(dg);
  };
  if (o.vib) lfo(o.vib.f, o.vib.depth, osc.frequency);
  if (o.trem) lfo(o.trem.f, o.trem.depth, g.gain);

  let head: AudioNode = osc;
  let filt: BiquadFilterNode | null = null;
  if (o.filter) {
    filt = makeFilter(ctx, o.filter);
    head.connect(filt);
    head = filt;
  }
  head.connect(g).connect(dest);

  osc.onended = () => {
    osc.disconnect();
    filt?.disconnect();
    g.disconnect();
    for (const l of lfos) l.disconnect();
    for (const n of extras) n.disconnect();
  };
  osc.start(t0);
  osc.stop(stopAt);
  return osc;
}

export interface NoiseHitOpts {
  dur: number;
  gain: number;
  delay?: number;
  filter?: FilterOpts;
}

/** an enveloped burst of the shared noise buffer (→ filter) → gain → dest */
export function noiseHit(ctx: BaseAudioContext, dest: AudioNode, o: NoiseHitOpts): AudioBufferSourceNode {
  const t0 = ctx.currentTime + (o.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true; // hits may outlast the buffer window; the envelope ends them

  const g = ctx.createGain();
  env(g.gain, { a: 0.005, d: o.dur, peak: o.gain, at: t0 });

  let head: AudioNode = src;
  let filt: BiquadFilterNode | null = null;
  if (o.filter) {
    filt = makeFilter(ctx, o.filter);
    head.connect(filt);
    head = filt;
  }
  head.connect(g).connect(dest);

  src.onended = () => {
    src.disconnect();
    filt?.disconnect();
    g.disconnect();
  };
  src.start(t0);
  src.stop(t0 + o.dur + 0.08);
  return src;
}

export interface ChordNote {
  f: number;
  /** seconds from now */
  at: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

/** a melodic figure — each note is its own self-cleaning tone */
export function chord(ctx: BaseAudioContext, dest: AudioNode, notes: ChordNote[]): void {
  for (const n of notes) {
    tone(ctx, dest, { type: n.type ?? "sine", f0: n.f, dur: n.dur, gain: n.gain ?? 0.12, delay: n.at });
  }
}
