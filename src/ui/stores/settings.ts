/* ============================================================================
   Player settings — a tiny persisted preference store shared by the TopBar gear,
   the SettingsModal, and the colony store's wiring (director toggle, live
   narrator gate, render quality, next-run difficulty).

   The load/save half is pure and storage-injectable (memory.ts loadModel
   pattern): merge-with-defaults inside try/catch, numeric clamping, never a
   throw — vitest runs in plain Node where there is no localStorage, and the
   browser may be in private mode. Nothing here touches window/AudioContext at
   import time. (Audio gain wiring consumes `audio.*` in the audio commit.)
   ============================================================================ */
import { ref, type Ref } from "vue";
import type { Difficulty } from "@shared/types";

export interface Settings {
  v: 1;
  audio: { master: number; sfx: number; ambient: number; muted: boolean };
  /** "auto" hands the renderer's quality ladder to the perf governor; "low"/
   *  "high" pin it to the legacy tiers */
  graphics: { quality: "auto" | "low" | "high" };
  narratorLive: boolean;
  directorEnabled: boolean;
  /** applied on the next reset — never mid-run (difficulty lives in the seedable state) */
  nextDifficulty: Difficulty;
}

/** a deep partial of Settings (one level of nesting is all we have) */
export interface SettingsPatch {
  audio?: Partial<Settings["audio"]>;
  graphics?: Partial<Settings["graphics"]>;
  narratorLive?: boolean;
  directorEnabled?: boolean;
  nextDifficulty?: Difficulty;
}

export type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

export const SETTINGS_KEY = "vivarium:settings:v1";

export const DEFAULTS: Settings = {
  v: 1,
  audio: { master: 0.8, sfx: 0.9, ambient: 0.7, muted: false },
  graphics: { quality: "auto" },
  narratorLive: true,
  directorEnabled: true,
  nextDifficulty: "normal",
};

// ---- pure load/save ----------------------------------------------------------

function clamp01(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** rebuild a full, valid Settings from anything — unknown JSON, a patch result,
 *  an old version. Every field falls back to its default; volumes clamp to [0,1];
 *  `v` is pinned to 1 so a future migration can switch on it. */
function normalize(raw: unknown): Settings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const a = (o.audio && typeof o.audio === "object" ? o.audio : {}) as Record<string, unknown>;
  const g = (o.graphics && typeof o.graphics === "object" ? o.graphics : {}) as Record<string, unknown>;
  return {
    v: 1,
    audio: {
      master: clamp01(a.master, DEFAULTS.audio.master),
      sfx: clamp01(a.sfx, DEFAULTS.audio.sfx),
      ambient: clamp01(a.ambient, DEFAULTS.audio.ambient),
      muted: bool(a.muted, DEFAULTS.audio.muted),
    },
    graphics: {
      // legacy profiles stored "low"/"high" — both pass through unchanged, so an
      // explicit pre-AUTO choice stays pinned; only fresh/invalid values get auto
      quality:
        g.quality === "auto" || g.quality === "low" || g.quality === "high"
          ? g.quality
          : DEFAULTS.graphics.quality,
    },
    narratorLive: bool(o.narratorLive, DEFAULTS.narratorLive),
    directorEnabled: bool(o.directorEnabled, DEFAULTS.directorEnabled),
    nextDifficulty:
      o.nextDifficulty === "easy" || o.nextDifficulty === "normal" || o.nextDifficulty === "hard"
        ? o.nextDifficulty
        : DEFAULTS.nextDifficulty,
  };
}

/** the browser's localStorage when it exists and is reachable, else null (Node, SSR) */
function defaultStorage(): SettingsStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(storage?: SettingsStorage): Settings {
  try {
    const st = storage ?? defaultStorage();
    const raw = st?.getItem(SETTINGS_KEY);
    if (!raw) return normalize(null);
    return normalize(JSON.parse(raw));
  } catch {
    return normalize(null); // corrupt JSON / private mode / no storage — defaults
  }
}

export function saveSettings(s: Settings, storage?: SettingsStorage): void {
  try {
    const st = storage ?? defaultStorage();
    st?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota — non-fatal, the in-memory value still rules */
  }
}

// ---- module-singleton reactive state ------------------------------------------

const settings: Ref<Settings> = ref<Settings>(loadSettings());
/** whether the settings modal is open — shared by the TopBar gear and the modal */
const settingsOpen = ref(false);

/** apply a deep partial, re-normalize (clamps volumes), persist. Replaces
 *  `settings.value` with a fresh object so deep watchers always see a change. */
export function updateSettings(patch: SettingsPatch, storage?: SettingsStorage): void {
  const cur = settings.value;
  const next = normalize({
    ...cur,
    ...patch,
    audio: { ...cur.audio, ...patch.audio },
    graphics: { ...cur.graphics, ...patch.graphics },
  });
  settings.value = next;
  saveSettings(next, storage);
}

export function useSettings() {
  return { settings, settingsOpen, updateSettings };
}
