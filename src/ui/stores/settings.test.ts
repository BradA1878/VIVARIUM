/* ============================================================================
   Settings store tests — the pure load/save/merge half (no DOM, no Vue mount).
   Storage is injected (Map-backed / throwing fakes) because vitest runs in plain
   Node: there is no localStorage here, and the module must never assume one.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import {
  DEFAULTS, SETTINGS_KEY, loadSettings, saveSettings, updateSettings, useSettings,
} from "./settings";

type Store = Pick<Storage, "getItem" | "setItem">;

function memStorage(seed?: Record<string, string>): Store & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

const throwing: Store = {
  getItem(): string | null { throw new Error("storage unavailable"); },
  setItem(): void { throw new Error("storage unavailable"); },
};

describe("settings load/save", () => {
  it("returns the defaults from an empty storage (a fresh object, not the constant)", () => {
    const st = memStorage();
    const s = loadSettings(st);
    expect(s).toEqual(DEFAULTS);
    expect(s).not.toBe(DEFAULTS); // mutating a loaded copy must never corrupt DEFAULTS
    expect(s.audio).not.toBe(DEFAULTS.audio);
  });

  it("round-trips the defaults through an injected Map-backed storage", () => {
    const st = memStorage();
    saveSettings(DEFAULTS, st);
    expect(st.map.has(SETTINGS_KEY)).toBe(true);
    expect(loadSettings(st)).toEqual(DEFAULTS);
  });

  it("merges a partial save with the defaults", () => {
    const st = memStorage({ [SETTINGS_KEY]: JSON.stringify({ v: 1, audio: { master: 0.5 } }) });
    const s = loadSettings(st);
    expect(s.audio.master).toBe(0.5);
    expect(s.audio.sfx).toBe(DEFAULTS.audio.sfx); // missing leaves the default
    expect(s.audio.muted).toBe(false);
    expect(s.graphics.quality).toBe("high");
    expect(s.nextDifficulty).toBe("normal");
  });

  it("survives corrupt JSON by falling back to the defaults", () => {
    const st = memStorage({ [SETTINGS_KEY]: "{{{ not json" });
    expect(loadSettings(st)).toEqual(DEFAULTS);
  });

  it("rejects wrong-typed fields back to the defaults", () => {
    const st = memStorage({
      [SETTINGS_KEY]: JSON.stringify({
        audio: { master: "loud", muted: "yes" },
        graphics: { quality: "ultra" },
        narratorLive: 1,
        nextDifficulty: "nightmare",
      }),
    });
    const s = loadSettings(st);
    expect(s.audio.master).toBe(DEFAULTS.audio.master);
    expect(s.audio.muted).toBe(false);
    expect(s.graphics.quality).toBe("high");
    expect(s.narratorLive).toBe(true);
    expect(s.nextDifficulty).toBe("normal");
  });

  it("clamps out-of-range volumes into [0, 1]", () => {
    const st = memStorage({
      [SETTINGS_KEY]: JSON.stringify({ audio: { master: 7, sfx: -3, ambient: 1.0001 } }),
    });
    const s = loadSettings(st);
    expect(s.audio.master).toBe(1);
    expect(s.audio.sfx).toBe(0);
    expect(s.audio.ambient).toBe(1);
  });

  it("normalizes the version field to 1 on load and preserves it through a round-trip", () => {
    const st = memStorage({ [SETTINGS_KEY]: JSON.stringify({ v: 99, narratorLive: false }) });
    const s = loadSettings(st);
    expect(s.v).toBe(1);
    expect(s.narratorLive).toBe(false);
    saveSettings(s, st);
    expect(loadSettings(st).v).toBe(1);
  });

  it("never throws when storage itself throws (load falls back, save is silent)", () => {
    expect(() => loadSettings(throwing)).not.toThrow();
    expect(loadSettings(throwing)).toEqual(DEFAULTS);
    expect(() => saveSettings(DEFAULTS, throwing)).not.toThrow();
  });
});

describe("settings singleton + updateSettings", () => {
  it("updateSettings applies a deep partial to the reactive singleton and persists it", () => {
    const st = memStorage();
    const { settings } = useSettings();
    const sfxBefore = settings.value.audio.sfx;

    updateSettings({ audio: { muted: true }, nextDifficulty: "hard" }, st);

    expect(settings.value.audio.muted).toBe(true);
    expect(settings.value.nextDifficulty).toBe("hard");
    expect(settings.value.audio.sfx).toBe(sfxBefore); // untouched siblings survive

    const persisted = JSON.parse(st.map.get(SETTINGS_KEY)!) as typeof DEFAULTS;
    expect(persisted.audio.muted).toBe(true);
    expect(persisted.nextDifficulty).toBe("hard");
    expect(persisted.v).toBe(1);
  });

  it("updateSettings clamps volumes and replaces the ref value (so deep watchers see a change)", () => {
    const st = memStorage();
    const { settings } = useSettings();
    const before = settings.value;

    updateSettings({ audio: { master: 42 } }, st);

    expect(settings.value.audio.master).toBe(1);
    expect(settings.value).not.toBe(before);
    expect((JSON.parse(st.map.get(SETTINGS_KEY)!) as typeof DEFAULTS).audio.master).toBe(1);
  });

  it("updateSettings stays silent when storage throws (the in-memory value still updates)", () => {
    const { settings } = useSettings();
    expect(() => updateSettings({ graphics: { quality: "low" } }, throwing)).not.toThrow();
    expect(settings.value.graphics.quality).toBe("low");
  });

  it("settingsOpen starts closed", () => {
    const { settingsOpen } = useSettings();
    expect(settingsOpen.value).toBe(false);
  });
});
