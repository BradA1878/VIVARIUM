/* ============================================================================
   Multi-slot persistence (PTP slice 1). Each settled world persists as its own
   slot; the default slot reuses the legacy single key so existing saves survive.
   Vitest runs in node (no localStorage) — inject a Map-backed Storage stand-in.
   ============================================================================ */
import { describe, it, expect, afterEach } from "vitest";
import { Colony } from "@/engine";
import { saveLocal, loadLocal, clearLocal, listLocal } from "./local";
import { saveRemote, loadRemote, listRemote, deleteRemote } from "./remote";
import { loadBest, persist, listSlots, deleteSlot } from "./index";
import { toJSON, type SaveJSON } from "./save";

/** Map-backed Storage stand-in (vitest runs in node — no localStorage). */
function fakeStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("local slot persistence", () => {
  it("round-trips a named slot and isolates slots", () => {
    const st = fakeStorage();
    const a = new Colony(11); a.tick(0.2);
    const b = new Colony(22); b.tick(0.2);
    saveLocal("ceres", a.serialize(), st);
    saveLocal("io", b.serialize(), st);
    expect(loadLocal("ceres", st)!.seed).toBe(11);
    expect(loadLocal("io", st)!.seed).toBe(22);
    clearLocal("ceres", st);
    expect(loadLocal("ceres", st)).toBeNull();
    expect(loadLocal("io", st)!.seed).toBe(22); // delete is scoped
  });

  it("the default slot reuses the legacy key (back-compat)", () => {
    const st = fakeStorage();
    const c = new Colony(33); c.tick(0.2);
    saveLocal("default", c.serialize(), st);
    expect(st.getItem("vivarium:save:v1")).toBeTruthy(); // legacy key, no suffix
    expect(loadLocal("default", st)!.seed).toBe(33);
  });

  it("listLocal returns written slots", () => {
    const st = fakeStorage();
    const c = new Colony(1); c.tick(0.2);
    saveLocal("default", c.serialize(), st);
    saveLocal("titan", c.serialize(), st);
    expect(new Set(listLocal(st))).toEqual(new Set(["default", "titan"]));
  });
});

// ---- remote adapter (slot threading; happy path keeps the breaker clear) ------

type FetchCall = { url: string; init?: RequestInit };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** stub global fetch; record calls; reply with the handler's {ok, body}. */
function stubFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; body?: unknown }): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init);
    return { ok: r.ok, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe("remote slot persistence", () => {
  it("saveRemote posts the slot + save to /api/save", async () => {
    const c = new Colony(44); c.tick(0.2);
    const calls = stubFetch(() => ({ ok: true, body: { ok: true } }));
    const ok = await saveRemote("ceres", c.serialize());
    expect(ok).toBe(true);
    expect(calls[0].url).toBe("/api/save");
    const body = JSON.parse(String(calls[0].init!.body));
    expect(body.slot).toBe("ceres");
    expect(body.save.seed).toBe(44);
  });

  it("loadRemote reads ?slot= and restores the save", async () => {
    const c = new Colony(55); c.tick(0.2);
    const calls = stubFetch(() => ({ ok: true, body: { save: toJSON(c.serialize()) } }));
    const got = await loadRemote("io");
    expect(calls[0].url).toBe("/api/load?slot=io");
    expect(got!.seed).toBe(55);
  });

  it("listRemote parses the slot list", async () => {
    stubFetch(() => ({ ok: true, body: { slots: [{ slot: "default" }, { slot: "titan" }] } }));
    expect(await listRemote()).toEqual(["default", "titan"]);
  });

  it("deleteRemote issues a DELETE for the slot", async () => {
    const calls = stubFetch(() => ({ ok: true, body: { ok: true } }));
    const ok = await deleteRemote("ceres");
    expect(ok).toBe(true);
    expect(calls[0].url).toBe("/api/save?slot=ceres");
    expect(calls[0].init!.method).toBe("DELETE");
  });
});

// ---- orchestration (index): a slot-keyed in-memory server stand-in -------------

/** emulate the Hono save server: a slot-keyed store backing save/load/list/delete. */
function stubServer(): void {
  const store = new Map<string, SaveJSON>();
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const slotOf = (s: string): string => new URLSearchParams(s.split("?")[1] ?? "").get("slot") ?? "";
    if (u === "/api/save" && init?.method === "POST") {
      const body = JSON.parse(String(init!.body)) as { slot: string; save: SaveJSON };
      store.set(body.slot, body.save);
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }
    if (u.startsWith("/api/save?") && init?.method === "DELETE") {
      store.delete(slotOf(u));
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }
    if (u.startsWith("/api/load")) {
      return { ok: true, json: async () => ({ save: store.get(slotOf(u)) ?? null }) } as Response;
    }
    if (u === "/api/saves") {
      return { ok: true, json: async () => ({ slots: [...store.keys()].map((slot) => ({ slot })) }) } as Response;
    }
    return { ok: false, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

describe("slot orchestration (index)", () => {
  it("persist + loadBest round-trip per slot, then listSlots + deleteSlot", async () => {
    stubServer();
    const a = new Colony(101); a.tick(0.2);
    const b = new Colony(202); b.tick(0.2);
    await persist("io", a.serialize());
    await persist("ceres", b.serialize());
    expect((await loadBest("io"))!.seed).toBe(101);
    expect((await loadBest("ceres"))!.seed).toBe(202);
    expect(new Set(await listSlots())).toEqual(new Set(["io", "ceres"]));
    await deleteSlot("io");
    expect(await loadBest("io")).toBeNull();
  });
});
