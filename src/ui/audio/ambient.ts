/* ============================================================================
   AmbientBed — the planet's continuous voice: four always-running loops whose
   gains the audio engine steers from deriveState() targets each snapshot.

     WIND   noise → lowpass 400 → lowpass 800 → gain        (always audible)
     RUMBLE noise → lowpass 90 → gain                       (meteor/quake bed)
     HUM    70Hz + 70.7Hz sines (a slow beat) → lowpass 300 (possession)
     DRIVE  48Hz + 48.6Hz saws (an engine beat) → lowpass 220 (rover piloting)
     DREAD  55Hz saw, pulsed at 4Hz → lowpass 200           (the UFO overhead)

   Everything moves by setTargetAtTime — no clicks, and a missed snapshot just
   means the bed keeps drifting toward the last target. Construction happens in
   start(); importing this file touches no Web Audio.
   ============================================================================ */
import { noiseBuffer } from "./synth";

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** wind gain at rest — matches deriveState's clear-day target */
const WIND_BASE = 0.18;

export class AmbientBed {
  private ctx: BaseAudioContext | null = null;
  /** sources to stop() on teardown */
  private srcs: AudioScheduledSourceNode[] = [];
  /** every node to disconnect on teardown */
  private nodes: AudioNode[] = [];

  private windGain: GainNode | null = null;
  private windLp1: BiquadFilterNode | null = null;
  private rumbleGain: GainNode | null = null;
  private humGain: GainNode | null = null;
  private driveGain: GainNode | null = null;
  private dreadGain: GainNode | null = null;

  /** build + start every loop at its resting level. Idempotent per bed. */
  start(ctx: BaseAudioContext, dest: AudioNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    const keep = <T extends AudioNode>(n: T): T => { this.nodes.push(n); return n; };
    const loopNoise = (): AudioBufferSourceNode => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      this.srcs.push(src);
      return keep(src);
    };
    const osc = (type: OscillatorType, f: number): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      this.srcs.push(o);
      return keep(o);
    };
    const gain = (v: number): GainNode => {
      const g = ctx.createGain();
      g.gain.value = v;
      return keep(g);
    };
    const lowpass = (freq: number): BiquadFilterNode => {
      const b = ctx.createBiquadFilter();
      b.type = "lowpass";
      b.frequency.value = freq;
      return keep(b);
    };

    // WIND — stacked lowpasses tame the hiss into a far-off roar; two slow LFOs
    // (one into the gain, one into the first cutoff) keep it breathing
    const wind = loopNoise();
    this.windLp1 = lowpass(400);
    const windLp2 = lowpass(800);
    this.windGain = gain(WIND_BASE);
    wind.connect(this.windLp1).connect(windLp2).connect(this.windGain).connect(dest);
    const gustGain = osc("sine", 0.08); // gain wobble
    const gustDepth = gain(0.05);
    gustGain.connect(gustDepth);
    gustDepth.connect(this.windGain.gain);
    const gustTone = osc("sine", 0.05); // timbre wobble: ±180Hz on the first cutoff
    const gustToneDepth = gain(180);
    gustTone.connect(gustToneDepth);
    gustToneDepth.connect(this.windLp1.frequency);

    // RUMBLE — sub-bass noise floor for telegraphed/active meteors and quakes
    const rumble = loopNoise();
    const rumbleLp = lowpass(90);
    this.rumbleGain = gain(0);
    rumble.connect(rumbleLp).connect(this.rumbleGain).connect(dest);

    // POSSESSION HUM — two sines 0.7Hz apart beat slowly, like suit electronics
    const hum1 = osc("sine", 70);
    const hum2 = osc("sine", 70.7);
    const humLp = lowpass(300);
    this.humGain = gain(0);
    hum1.connect(humLp);
    hum2.connect(humLp);
    humLp.connect(this.humGain).connect(dest);

    // ROVER DRIVE — the hum's mechanical cousin: two saws 0.6Hz apart growl
    // like a drivetrain under load, kept dark by the lowpass
    const drive1 = osc("sawtooth", 48);
    const drive2 = osc("sawtooth", 48.6);
    const driveLp = lowpass(220);
    this.driveGain = gain(0);
    drive1.connect(driveLp);
    drive2.connect(driveLp);
    driveLp.connect(this.driveGain).connect(dest);

    // UFO DREAD — a low saw whose gain pulses at 4Hz; dreadGain meters how close
    const dread = osc("sawtooth", 55);
    const dreadLp = lowpass(200);
    const pulse = gain(0.5);
    const pulseLfo = osc("sine", 4);
    const pulseDepth = gain(0.5);
    pulseLfo.connect(pulseDepth);
    pulseDepth.connect(pulse.gain);
    this.dreadGain = gain(0);
    dread.connect(dreadLp).connect(pulse).connect(this.dreadGain).connect(dest);

    for (const s of this.srcs) s.start();
  }

  /** glide toward a wind level (deriveState's 0.18 clear … 1.0 full storm);
   *  stormy opens the first cutoff 400→1400Hz so the storm hisses, not hums */
  setWind(intensity01: number, stormy: boolean): void {
    if (!this.ctx || !this.windGain || !this.windLp1) return;
    const now = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(clamp01(intensity01), now, 2.5);
    this.windLp1.frequency.setTargetAtTime(stormy ? 1400 : 400, now, 2.5);
  }

  setHum(on: boolean): void {
    if (!this.ctx || !this.humGain) return;
    this.humGain.gain.setTargetAtTime(on ? 0.07 : 0, this.ctx.currentTime, 0.4);
  }

  setDrive(on: boolean): void {
    if (!this.ctx || !this.driveGain) return;
    this.driveGain.gain.setTargetAtTime(on ? 0.06 : 0, this.ctx.currentTime, 0.4);
  }

  setDread(level: 0 | 0.5 | 1): void {
    if (!this.ctx || !this.dreadGain) return;
    this.dreadGain.gain.setTargetAtTime(level * 0.12, this.ctx.currentTime, 1.0);
  }

  setRumble(level01: number): void {
    if (!this.ctx || !this.rumbleGain) return;
    this.rumbleGain.gain.setTargetAtTime(clamp01(level01), this.ctx.currentTime, 0.6);
  }

  /** stop + disconnect every loop; safe to call twice */
  stop(): void {
    for (const s of this.srcs) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    for (const n of this.nodes) {
      try { n.disconnect(); } catch { /* already gone */ }
    }
    this.srcs = [];
    this.nodes = [];
    this.ctx = null;
    this.windGain = this.rumbleGain = this.humGain = this.driveGain = this.dreadGain = null;
    this.windLp1 = null;
  }
}
