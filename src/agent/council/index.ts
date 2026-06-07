/* ============================================================================
   The Council orchestrator. Collects candidate lines from every voice for an
   event, then arbitrates: highest severity wins, and on a tie the more
   specialized voice speaks (so the Watcher names a cascade where VIVARIUM would
   only mourn it). Owns all cooldowns — global, per-voice, per-topic — so the
   chorus stays sparse and no single member dominates. (Doc §3.3, §7.)
   ============================================================================ */
import type { ColonyEvent, Snapshot } from "@shared/types";
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
}

const GLOBAL_COOLDOWN = 5.5; // seconds between any two lines (any voice)
const VOICE_COOLDOWN = 16; // a single voice won't speak again this soon
const TYPE_COOLDOWN = 22; // same voice + same event type
const OVERRIDE = 4; // severity that speaks through every cooldown

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
        return { register: c.register, speaker: c.speaker, line: c.line, persona: c.persona };
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
    return { register: candidate.register, speaker: candidate.speaker, line: candidate.line, persona: candidate.persona };
  }

  /** commit cooldowns after a candidate spoke (live OR scripted) */
  commit(candidate: Candidate, event: ColonyEvent, now: number): void {
    this.mark(candidate, event, now);
  }

  bootLine(): Utterance {
    const banks = bootLines();
    return { register: "vivarium", speaker: "VIVARIUM", line: banks[0], persona: "vivarium" };
  }

  reset(): void {
    this.lastGlobal = -999;
    this.lastByVoice = {};
    this.lastByTopic = {};
    for (const v of this.voices) v.reset?.();
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
