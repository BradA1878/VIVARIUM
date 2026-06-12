/* ============================================================================
   The Council orchestrator. Collects candidate lines from every voice for an
   event, then arbitrates: highest severity wins, and on a tie the more
   specialized voice speaks (so the Watcher names a cascade where VIVARIUM would
   only mourn it). Owns all cooldowns — global, per-voice, per-topic — so the
   chorus stays sparse and no single member dominates. (Doc §3.3, §7.)
   ============================================================================ */
import type { ColonyEvent, Difficulty, Snapshot } from "@shared/types";
import { worldStore } from "../worldmodel";
import { bootLines } from "../lines";
import type { Candidate, Register, Voice, VoiceContext } from "./types";
import { VivariumVoice } from "./vivarium";
import { WatcherVoice } from "./watcher";
import { StrategistVoice } from "./strategist";
import { ChroniclerVoice } from "./chronicler";

export interface Utterance {
  register: Register;
  speaker: string;
  line: string;
  persona: Register;
  /** the winning candidate's severity (0 = idle/boot) — the ticker's crit-flash cue */
  severity: number;
}

const GLOBAL_COOLDOWN = 5.5; // seconds between any two lines (any voice)
const VOICE_COOLDOWN = 16; // a single voice won't speak again this soon
const TYPE_COOLDOWN = 22; // same voice + same event type
const OVERRIDE = 4; // severity that speaks through every cooldown

// idle banter — a separate, slower clock that NEVER touches the real gates
const IDLE_GAP_MIN = 25; // quiet sim-seconds before banter may start...
const IDLE_GAP_MAX = 40; // ...rerolled uniformly in [min,max] after each line
const IDLE_VOICE_COOLDOWN = 90; // one voice banters at most this often

/** tiebreak order — specialized voices win ties so they actually get heard */
const PRIORITY: Register[] = ["watcher", "strategist", "chronicler", "vivarium"];

export class Council {
  private voices: Voice[] = [
    new VivariumVoice(),
    new WatcherVoice(),
    new StrategistVoice(),
    new ChroniclerVoice(),
  ];
  private lastGlobal = -999;
  private lastByVoice: Record<string, number> = {};
  private lastByTopic: Record<string, number> = {};

  // ---- idle-banter state (entirely separate from the books above) ----
  /** injectable randomness for the gap reroll — agent layer, so the global
   *  random is fine; tests pin it through the constructor */
  private rand: () => number;
  private idleGap: number;
  private lastIdleT = -999;
  private lastIdleByVoice: Record<string, number> = {};
  /** index of the voice that starts the next idle round-robin */
  private idleStart = 0;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
    this.idleGap = this.rollIdleGap();
  }

  /** the line the council speaks for this event, or null if silenced/none */
  observe(event: ColonyEvent, snapshot: Snapshot | null, now: number): Utterance | null {
    const ctx: VoiceContext = { event, snapshot, world: worldStore, now };
    const candidates = this.voices
      .map((v) => v.consider(ctx))
      .filter((c): c is Candidate => c != null)
      .sort((a, b) => b.severity - a.severity || PRIORITY.indexOf(a.register) - PRIORITY.indexOf(b.register));

    for (const c of candidates) {
      if (this.passes(c, event, now)) {
        this.mark(c, event, now);
        return { register: c.register, speaker: c.speaker, line: c.line, persona: c.persona, severity: c.severity };
      }
    }
    return null;
  }

  /** gate check only — used by the live build before spending a model call */
  shouldSpeak(event: ColonyEvent, snapshot: Snapshot | null, now: number): Candidate | null {
    const ctx: VoiceContext = { event, snapshot, world: worldStore, now };
    const candidates = this.voices
      .map((v) => v.consider(ctx))
      .filter((c): c is Candidate => c != null)
      .sort((a, b) => b.severity - a.severity || PRIORITY.indexOf(a.register) - PRIORITY.indexOf(b.register));
    return candidates.find((c) => this.passes(c, event, now)) ?? null;
  }

  /** scripted line for a chosen candidate (the live-build fallback) */
  lineFor(candidate: Candidate): Utterance {
    return { register: candidate.register, speaker: candidate.speaker, line: candidate.line, persona: candidate.persona, severity: candidate.severity };
  }

  /** commit cooldowns after a candidate spoke (live OR scripted) */
  commit(candidate: Candidate, event: ColonyEvent, now: number): void {
    this.mark(candidate, event, now);
  }

  /** a severity-0 line for a long quiet stretch, or null. Scripted-only BY
   *  CONSTRUCTION: this returns a finished Utterance and shares nothing with
   *  shouldSpeak/narrateLive, so the live model is unreachable from idle.
   *  `lastRealEventT` is the caller's clock of the last routed real event. */
  observeIdle(snapshot: Snapshot | null, simNow: number, lastRealEventT: number): Utterance | null {
    if (!snapshot) return null;
    // the quiet predicate — banter only when truly nothing is happening
    if (simNow - lastRealEventT < this.idleGap) return null;
    if (simNow - this.lastIdleT < this.idleGap) return null;
    if (snapshot.hazards.length > 0) return null;
    const tm = snapshot.timers;
    if (tm.oxygen != null || tm.water != null || tm.food != null) return null;
    if (snapshot.trade != null || snapshot.ufo != null) return null;
    if (snapshot.paused || snapshot.outcome) return null;

    const event: ColonyEvent = { type: "idle", t: simNow, sol: snapshot.sol, tod: snapshot.tod };
    const ctx: VoiceContext = { event, snapshot, world: worldStore, now: simNow };
    // round-robin from a rotating start so vivarium never owns the sev-0 tie
    const n = this.voices.length;
    for (let k = 0; k < n; k++) {
      const v = this.voices[(this.idleStart + k) % n];
      if (simNow - (this.lastIdleByVoice[v.id] ?? -999) < IDLE_VOICE_COOLDOWN) continue;
      const c = v.considerIdle?.(ctx);
      if (!c) continue;
      this.markIdle(c, simNow);
      return { register: c.register, speaker: c.speaker, line: c.line, persona: c.persona, severity: c.severity };
    }
    return null;
  }

  /** book a spoken banter line. CRITICAL: marks ONLY the idle state — lastGlobal,
   *  the voice cooldowns, and the topic cooldowns stay untouched, so a real
   *  severity-1 event arriving one second later passes as if nothing was said. */
  markIdle(c: Candidate, simNow: number): void {
    this.lastIdleByVoice[c.register] = simNow;
    this.lastIdleT = simNow;
    const idx = this.voices.findIndex((v) => v.id === c.register);
    this.idleStart = ((idx >= 0 ? idx : this.idleStart) + 1) % this.voices.length;
    this.idleGap = this.rollIdleGap();
  }

  bootLine(difficulty?: Difficulty): Utterance {
    const banks = bootLines(difficulty);
    return { register: "vivarium", speaker: "VIVARIUM", line: banks[0], persona: "vivarium", severity: 0 };
  }

  reset(): void {
    this.lastGlobal = -999;
    this.lastByVoice = {};
    this.lastByTopic = {};
    this.lastIdleT = -999;
    this.lastIdleByVoice = {};
    this.idleStart = 0;
    this.idleGap = this.rollIdleGap();
    for (const v of this.voices) v.reset?.();
  }

  private rollIdleGap(): number {
    return IDLE_GAP_MIN + this.rand() * (IDLE_GAP_MAX - IDLE_GAP_MIN);
  }

  private topicKey(c: Candidate, e: ColonyEvent): string {
    return `${c.register}:${e.type}:${e.res ?? ""}`;
  }

  private passes(c: Candidate, e: ColonyEvent, now: number): boolean {
    if (c.severity >= OVERRIDE) return true;
    if (now - this.lastGlobal < GLOBAL_COOLDOWN) return false;
    if (now - (this.lastByVoice[c.register] ?? -999) < VOICE_COOLDOWN) return false;
    if (now - (this.lastByTopic[this.topicKey(c, e)] ?? -999) < TYPE_COOLDOWN) return false;
    return true;
  }

  private mark(c: Candidate, e: ColonyEvent, now: number): void {
    this.lastGlobal = now;
    this.lastByVoice[c.register] = now;
    this.lastByTopic[this.topicKey(c, e)] = now;
  }
}

export type { Register, Candidate } from "./types";
