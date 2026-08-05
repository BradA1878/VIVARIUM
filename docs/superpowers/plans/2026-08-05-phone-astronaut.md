# Phone Astronaut (Tier 2 Mobile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone (below the 560×440 viewport floor) can join a friend's colony as a co-op astronaut through a join form on the ViewportGate, and plays with a shed-down cockpit HUD (PilotBar + vitals strip + ticker).

**Architecture:** The `ViewportGate` becomes a reactive fork (the "Field Console"): hidden on wide viewports, a join form on phones, lifted while a guest session is connected. A shared `belowFloor` ref (matchMedia) plus the store's existing `mode`/`netStatus` drive both the gate and a `hud--phone` class that hides everything but the cockpit. Joining reuses App.vue's existing `joinGame`; **zero engine, protocol, `src/net/`, or store-API changes**.

**Tech Stack:** Vue 3 `<script setup>`, module-singleton store (`useColony()`), Vitest for pure helpers, Playwright (`mobile-chromium` project = Pixel 7, 412×915 — naturally below the floor).

**Spec:** `docs/superpowers/specs/2026-08-05-phone-astronaut-design.md`

## Global Constraints

- **Never** modify `src/engine/`, `src/worker/protocol.ts`, `src/worker/host.ts`, `src/net/*`, or persistence. This feature only observes (`snapshot`, `mode`, `netStatus`) and emits the existing `join` payload.
- Every new behavior is gated behind `belowFloor && mode === "guest"` (HUD) or `belowFloor` (gate) — desktop/tablet and solo play must be pixel-identical. The desktop e2e project passing unchanged is the regression check.
- The floor query is verbatim `(max-width: 559px), (max-height: 439px)` — one constant, `FLOOR_QUERY`, consumed everywhere (no second copy of the numbers anywhere, including CSS).
- HUD copy stays in the dry telemetry register (lowercase hints, `·` separators, no exclamation marks). New user-facing strings in this plan are final — do not improvise copy.
- CI e2e must never depend on a live host or working Nostr relays: assert only the form UI, the `?join=` prefill, and the no-host `failed` outcome (`JOIN_TIMEOUT_MS = 15_000` in `src/net/netBridge.ts` bounds it; a network-less environment fails faster via the join `catch`).
- `npm run typecheck && npm test` green after every task; full `npx playwright test` green at Tasks 2, 4, and 5.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/ui/components/fieldconsole.ts` | create | pure gate logic: `FLOOR_QUERY`, `gateView`, `parseJoinCode`, `consoleStatus` |
| `src/ui/components/fieldconsole.test.ts` | create | unit tests for the above |
| `src/ui/viewport.ts` | create | shared `belowFloor` ref (matchMedia glue, module singleton) |
| `src/ui/components/ViewportGate.vue` | rewrite | the Field Console fork (form + states + emit) |
| `src/ui/App.vue` | modify | `@join` wiring, `phoneGuest` computed, `hud--phone` class, hint suppression, VitalsStrip mount |
| `src/ui/components/vitals.ts` | create | pure vitals formatting: `trendOf`, `vitalText` |
| `src/ui/components/vitals.test.ts` | create | unit tests for the above |
| `src/ui/components/VitalsStrip.vue` | create | the phone strip (brand · sol · connection dot · four vitals) |
| `src/ui/components/PilotBar.vue` | modify | guest spectate banner replaces PILOT COMMANDER for guests |
| `src/ui/style/hud.css` | modify | `hud--phone` shed-down block + ≥48px touch targets |
| `e2e/phone.spec.ts` | create | offline Field Console e2e |
| `e2e/vivarium.spec.ts` | modify | gate test heading: "wider console required" → "field console" |
| `docs/development.md` | modify | phone-guest manual validation note |
| `CLAUDE.md` | modify | one sentence in the co-op bullet |

---

### Task 1: Field Console pure logic (`fieldconsole.ts`)

**Files:**
- Create: `src/ui/components/fieldconsole.ts`
- Test: `src/ui/components/fieldconsole.test.ts`

**Interfaces:**
- Consumes: `NetStatus` type from `src/ui/stores/colony.ts` (`"idle" | "connecting" | "connected" | "failed" | "host-left"`), **type-only import** (the unit test must stay node-safe).
- Produces (Tasks 2–4 rely on these exact names):
  - `FLOOR_QUERY: string` — `"(max-width: 559px), (max-height: 439px)"`
  - `gateView(belowFloor: boolean, mode: "solo" | "host" | "guest", netStatus: NetStatus): "hidden" | "console"`
  - `parseJoinCode(search: string): string`
  - `consoleStatus(netStatus: NetStatus): { text: string; warn: boolean } | null`

- [ ] **Step 1: Write the failing test**

```ts
// src/ui/components/fieldconsole.test.ts
import { describe, expect, it } from "vitest";
import { FLOOR_QUERY, consoleStatus, gateView, parseJoinCode } from "./fieldconsole";

describe("gateView — the spec §1 priority table", () => {
  it("hides above the floor regardless of session", () => {
    expect(gateView(false, "solo", "idle")).toBe("hidden");
    expect(gateView(false, "guest", "connected")).toBe("hidden");
    expect(gateView(false, "guest", "failed")).toBe("hidden");
  });
  it("lifts below the floor only while a guest session is connected", () => {
    expect(gateView(true, "guest", "connected")).toBe("hidden");
  });
  it("shows the console below the floor in every other state", () => {
    expect(gateView(true, "solo", "idle")).toBe("console");
    expect(gateView(true, "guest", "connecting")).toBe("console");
    expect(gateView(true, "guest", "failed")).toBe("console");
    expect(gateView(true, "guest", "host-left")).toBe("console");
    expect(gateView(true, "host", "connected")).toBe("console"); // hosting needs a wide console
  });
});

describe("parseJoinCode — ?join= prefill", () => {
  it("reads the join param", () => {
    expect(parseJoinCode("?join=marsbase")).toBe("marsbase");
  });
  it("trims and clamps to the Lobby's 24-char limit", () => {
    expect(parseJoinCode("?join=%20%20padded%20%20")).toBe("padded");
    expect(parseJoinCode(`?join=${"x".repeat(40)}`)).toBe("x".repeat(24));
  });
  it("returns empty for absent or malformed input", () => {
    expect(parseJoinCode("")).toBe("");
    expect(parseJoinCode("?other=1")).toBe("");
  });
});

describe("consoleStatus — the form's status line", () => {
  it("is null when idle or connected (the founding copy shows instead)", () => {
    expect(consoleStatus("idle")).toBeNull();
    expect(consoleStatus("connected")).toBeNull();
  });
  it("maps the three live states", () => {
    expect(consoleStatus("connecting")).toEqual({ text: "Connecting to the host…", warn: false });
    expect(consoleStatus("failed")).toEqual({ text: "No host answered — check the code and try again.", warn: true });
    expect(consoleStatus("host-left")).toEqual({ text: "Host disconnected. Rejoin with the same code.", warn: true });
  });
});

describe("FLOOR_QUERY", () => {
  it("is the gate's exact 560×440 floor", () => {
    expect(FLOOR_QUERY).toBe("(max-width: 559px), (max-height: 439px)");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/components/fieldconsole.test.ts`
Expected: FAIL — `Cannot find module './fieldconsole'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

```ts
// src/ui/components/fieldconsole.ts
/* ============================================================================
   Field Console logic — the pure half of ViewportGate's phone fork (tier 2
   mobile, spec docs/superpowers/specs/2026-08-05-phone-astronaut-design.md).
   Below the 560×440 floor the gate is a JOIN fork, not a wall; while a guest
   session is connected it lifts entirely. DOM-free so the unit tests stay
   node-safe (the matchMedia glue lives in ui/viewport.ts).
   ============================================================================ */
import type { NetStatus } from "../stores/colony";

/** the one copy of the viewport floor — the gate CSS was retired in favour of
 *  this (reactive) query, so these numbers exist nowhere else */
export const FLOOR_QUERY = "(max-width: 559px), (max-height: 439px)";

export type GateView = "hidden" | "console";

/** spec §1 priority table: wide → hidden; connected guest → hidden (the phone
 *  HUD owns the screen); everything else below the floor → the console */
export function gateView(
  belowFloor: boolean,
  mode: "solo" | "host" | "guest",
  netStatus: NetStatus,
): GateView {
  if (!belowFloor) return "hidden";
  if (mode === "guest" && netStatus === "connected") return "hidden";
  return "console";
}

/** ?join=CODE invite-link prefill — same trim + 24-char clamp as the Lobby's
 *  room-code field */
export function parseJoinCode(search: string): string {
  try {
    return (new URLSearchParams(search).get("join") ?? "").trim().slice(0, 24);
  } catch {
    return "";
  }
}

/** the status line under the join form; null = no session activity, show the
 *  founding copy alone. Wording matches the Lobby's roster lines. */
export function consoleStatus(netStatus: NetStatus): { text: string; warn: boolean } | null {
  switch (netStatus) {
    case "connecting": return { text: "Connecting to the host…", warn: false };
    case "failed": return { text: "No host answered — check the code and try again.", warn: true };
    case "host-left": return { text: "Host disconnected. Rejoin with the same code.", warn: true };
    default: return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/components/fieldconsole.test.ts`
Expected: PASS (9 tests). Also run `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/fieldconsole.ts src/ui/components/fieldconsole.test.ts
git commit -m "feat(vivarium): field-console pure logic — gate fork states, ?join= prefill"
```

---

### Task 2: ViewportGate becomes the Field Console

**Files:**
- Create: `src/ui/viewport.ts`
- Rewrite: `src/ui/components/ViewportGate.vue`
- Modify: `src/ui/App.vue` (one attribute on line ~354: `<ViewportGate v-if="!booting" />` → add `@join="onJoin"`)
- Modify: `e2e/vivarium.spec.ts:149-170` (gate heading changed)
- Create: `e2e/phone.spec.ts`

**Interfaces:**
- Consumes: Task 1's `FLOOR_QUERY`, `gateView`, `parseJoinCode`, `consoleStatus`; the store's `useColony()` → `{ mode, netStatus }`; App.vue's existing `onJoin(p: { code: string; name: string })` (line ~252, feeds `joinGame` which tears down the local worker and boots a `NetBridge` — verified, no changes needed there).
- Produces: `belowFloor: Ref<boolean>` exported from `src/ui/viewport.ts` (Task 4 reuses it); the gate emits `join { code, name }` — identical payload to `Lobby.vue`'s.

- [ ] **Step 1: Write the failing e2e (red)**

```ts
// e2e/phone.spec.ts
import { expect, test } from "@playwright/test";

/* Field Console (tier 2 phone astronaut): below the 560×440 floor the gate is
   a join fork, not a wall. Only offline-assertable paths run here — no host
   answers in CI, which IS the `failed` story (JOIN_TIMEOUT_MS = 15 s; a
   network-less environment fails faster through the join catch). The live
   two-client loop is the documented manual check in docs/development.md. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Opaque bootstrap documents have no storage; the app origin does.
    }
  });
});

test("phone: the gate is a field console with a join form", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "phone adaptation check");
  await page.goto("/");
  await page.locator(".boot").click({ timeout: 4_000 }).catch(() => {});

  await expect(page.getByRole("heading", { name: /field console/i })).toBeVisible();
  await expect(page.getByText(/joining one works right here/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /join as astronaut/i })).toBeDisabled(); // no code yet
  await page.getByPlaceholder("e.g. marsbase").fill("someroom");
  await expect(page.getByRole("button", { name: /join as astronaut/i })).toBeEnabled();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("phone: ?join= prefills the code and a dead room reports failure", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "phone adaptation check");
  test.setTimeout(90_000); // rides out JOIN_TIMEOUT_MS with margin
  const deadRoom = `e2e-dead-${Date.now().toString(36)}`; // unique → no stranger's host can answer
  await page.goto(`/?join=${deadRoom}`);
  await page.locator(".boot").click({ timeout: 4_000 }).catch(() => {});

  await expect(page.getByPlaceholder("e.g. marsbase")).toHaveValue(deadRoom);
  await page.getByPlaceholder("your name").fill("Ada");
  await page.getByRole("button", { name: /join as astronaut/i }).click();

  // end state only — `connecting` may be too brief to assert when the network
  // layer throws immediately (offline CI)
  await expect(page.getByText(/no host answered/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder("e.g. marsbase")).toHaveValue(deadRoom); // code survives for retry
});
```

- [ ] **Step 2: Run it to verify it fails for the right reason**

Run: `npx playwright test e2e/phone.spec.ts --project=mobile-chromium`
Expected: FAIL — heading `/field console/i` not found (today's gate says "WIDER CONSOLE REQUIRED" and has no form). A boot-flow error is the WRONG failure — fix the harness until the failures are the missing feature.

- [ ] **Step 3: Create the shared viewport ref**

```ts
// src/ui/viewport.ts
/* Shared "below the 560×440 floor" viewport fact — the ONE source of truth for
   the Field Console (ViewportGate) and the phone HUD mode (App.vue). Module
   singleton like the store; the query itself lives in fieldconsole.ts so the
   floor's numbers exist exactly once. */
import { ref } from "vue";
import { FLOOR_QUERY } from "./components/fieldconsole";

export const belowFloor = ref(false);

if (typeof window !== "undefined" && "matchMedia" in window) {
  const mq = window.matchMedia(FLOOR_QUERY);
  belowFloor.value = mq.matches;
  mq.addEventListener("change", (e) => {
    belowFloor.value = e.matches;
  });
}
```

- [ ] **Step 4: Rewrite ViewportGate.vue**

Replace the whole file:

```vue
<script setup lang="ts">
/* ============================================================================
   ViewportGate → the Field Console (tier 2 mobile, spec 2026-08-05). Wide
   viewports: hidden. Below the 560×440 floor it is a FORK, not a wall —
   founding still needs a wider console, but JOINING a friend's colony as an
   astronaut works right here. While a guest session is connected the gate
   lifts (the phone HUD owns the screen); on failed/host-left it returns with
   the warning and the code still filled. ?join=CODE prefills the room code so
   a host can text an invite link. Visibility is reactive now — the old CSS
   media query moved into ui/viewport.ts (same FLOOR_QUERY).
   ============================================================================ */
import { computed, ref } from "vue";
import { useColony } from "../stores/colony";
import { belowFloor } from "../viewport";
import { consoleStatus, gateView, parseJoinCode } from "./fieldconsole";

const { mode, netStatus } = useColony();
const emit = defineEmits<{ join: [payload: { code: string; name: string }] }>();

const name = ref("");
const code = ref(parseJoinCode(typeof location !== "undefined" ? location.search : ""));

const view = computed(() => gateView(belowFloor.value, mode.value, netStatus.value));
const status = computed(() => consoleStatus(netStatus.value));
const joining = computed(() => netStatus.value === "connecting");

function join(): void {
  if (!code.value.trim() || joining.value) return;
  emit("join", { code: code.value.trim(), name: name.value.trim() || "Astronaut" });
}
</script>

<template>
  <div v-if="view === 'console'" class="viewport-gate" aria-labelledby="viewport-title">
    <div class="viewport-card">
      <div class="viewport-mark" aria-hidden="true">◇</div>
      <h1 id="viewport-title">FIELD CONSOLE</h1>
      <p>
        Founding a colony needs at least a 560 × 440 console.
        <strong>Joining one works right here.</strong>
      </p>

      <form class="gate-join" @submit.prevent="join">
        <label class="gj-field">
          <span class="gj-lbl">callsign</span>
          <input class="gj-in" v-model="name" maxlength="16" placeholder="your name" />
        </label>
        <label class="gj-field">
          <span class="gj-lbl">room code</span>
          <input class="gj-in" v-model="code" maxlength="24" placeholder="e.g. marsbase" />
        </label>
        <button class="gj-btn" type="submit" :disabled="!code.trim() || joining">
          &rarr; JOIN AS ASTRONAUT
        </button>
      </form>

      <p v-if="status" class="gate-status" :class="{ warn: status.warn }" aria-live="polite">
        {{ status.text }}
      </p>

      <span class="gate-foot">Your colony save remains intact. Solo play &rarr; a laptop or tablet.</span>
    </div>
  </div>
</template>

<style scoped>
.viewport-gate {
  position: absolute;
  inset: 0;
  z-index: 120;
  display: grid;
  /* card anchors in the upper half so the phone keyboard never covers the
     active field; the gate itself scrolls if it must */
  place-items: start center;
  overflow-y: auto;
  max-height: 100dvh;
  padding: max(24px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  pointer-events: auto;
  background: radial-gradient(120% 100% at 50% 40%, #0b1115, #040507);
  font-family: var(--mono);
}
.viewport-card { width: min(390px, 100%); margin-top: 5dvh; text-align: center; }
.viewport-mark { margin-bottom: 15px; color: var(--cyan); font-size: 30px; text-shadow: 0 0 18px rgba(127, 212, 232, 0.5); }
.viewport-card h1 { margin: 0 0 12px; color: #e6eef1; font-size: 14px; font-weight: 500; letter-spacing: 0.2em; }
.viewport-card p { margin: 0 0 14px; color: var(--ink); font-family: var(--serif); font-size: 15px; font-style: italic; line-height: 1.55; }
.viewport-card p strong { color: #9bd6a0; font-weight: 500; }

.gate-join { display: flex; flex-direction: column; gap: 8px; margin: 0 0 12px; text-align: left; }
.gj-field { display: flex; align-items: center; gap: 8px; }
.gj-lbl { flex: 0 0 72px; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
.gj-in {
  flex: 1;
  min-height: 44px;
  font-family: var(--mono);
  font-size: 14px;
  color: #e6eef1;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--hair2);
  border-radius: 3px;
  padding: 5px 9px;
}
.gj-in:focus { border-color: rgba(155, 214, 160, 0.6); }
.gj-btn {
  min-height: 48px;
  margin-top: 2px;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.14em;
  color: #9bd6a0;
  border: 1px solid rgba(155, 214, 160, 0.45);
  border-radius: 3px;
  background: rgba(155, 214, 160, 0.08);
}
.gj-btn:disabled { color: var(--faint); border-color: var(--hair2); background: transparent; }

.gate-status { margin: 0 0 12px; font-size: 11px; color: var(--dim); }
.gate-status.warn { color: #e07a5f; }
.gate-foot { color: var(--dim); font-size: 10px; letter-spacing: 0.08em; }
</style>
```

Note the removals: the old `@media` block (visibility is reactive now) and `role="alert"` (it is an interactive console, not an alert; the status line carries `aria-live="polite"`).

- [ ] **Step 5: Wire the emit in App.vue**

Line ~354, one attribute:

```html
<ViewportGate v-if="!booting" @join="onJoin" />
```

(`onJoin` exists at line ~252 and already feeds `joinGame`.)

- [ ] **Step 6: Update the existing gate e2e**

In `e2e/vivarium.spec.ts`, the test `"small screens explain the viewport requirement and recover in landscape"` (line ~149): replace both `getByRole("heading", { name: /wider console required/i })` assertions with `/field console/i`, and replace the `getByText(/colony save remains intact/i)` assertion with `getByText(/joining one works right here/i)`. The resize-to-800×600 recovery and overflow assertions stay untouched.

- [ ] **Step 7: Run the e2e to verify green**

Run: `npx playwright test --project=mobile-chromium`
Expected: PASS — both `phone.spec.ts` tests (the dead-room one takes ~15–20 s) and the updated gate test. Then `npm run typecheck && npm test` — clean. Then the full `npx playwright test` — the desktop project must be untouched-green.

- [ ] **Step 8: Commit**

```bash
git add src/ui/viewport.ts src/ui/components/ViewportGate.vue src/ui/App.vue e2e/phone.spec.ts e2e/vivarium.spec.ts
git commit -m "feat(vivarium): the viewport gate becomes the field console — phones join co-op"
```

---

### Task 3: VitalsStrip (`vitals.ts` + `VitalsStrip.vue`)

**Files:**
- Create: `src/ui/components/vitals.ts`
- Test: `src/ui/components/vitals.test.ts`
- Create: `src/ui/components/VitalsStrip.vue`

**Interfaces:**
- Consumes: `Pool { amount, capacity }` and `Resource = "power" | "water" | "oxygen" | "food"` from `@shared/types`; `useColony()` → `{ snapshot, netStatus }` (`snapshot.value.pools[r]`, `snapshot.value.flow[r]`, `snapshot.value.sol`).
- Produces: `trendOf(flow: number): "up" | "down" | "flat"`, `vitalText(pool: Pool): string`; the `<VitalsStrip />` component Task 4 mounts.

- [ ] **Step 1: Write the failing test**

```ts
// src/ui/components/vitals.test.ts
import { describe, expect, it } from "vitest";
import { trendOf, vitalText } from "./vitals";

describe("trendOf", () => {
  it("reads clear flows as up/down", () => {
    expect(trendOf(2.4)).toBe("up");
    expect(trendOf(-0.5)).toBe("down");
  });
  it("reads near-zero flow as flat (both signs)", () => {
    expect(trendOf(0)).toBe("flat");
    expect(trendOf(0.04)).toBe("flat");
    expect(trendOf(-0.04)).toBe("flat");
  });
});

describe("vitalText", () => {
  it("rounds the amount and shows the capacity", () => {
    expect(vitalText({ amount: 81.7, capacity: 200 })).toBe("82/200");
    expect(vitalText({ amount: 0, capacity: 60 })).toBe("0/60");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/components/vitals.test.ts`
Expected: FAIL — module `./vitals` not found.

- [ ] **Step 3: Write the helper + the component**

```ts
// src/ui/components/vitals.ts
/* Pure formatting for the phone VitalsStrip (tier 2, spec §2) — the astronaut's
   one-line colony readout. Node-safe on purpose. */
import type { Pool } from "@shared/types";

export type Trend = "up" | "down" | "flat";

/** |flow| under this reads as holding steady — hides the rail's ± jitter */
const FLAT_EPS = 0.05;

export function trendOf(flow: number): Trend {
  if (flow > FLAT_EPS) return "up";
  if (flow < -FLAT_EPS) return "down";
  return "flat";
}

export function vitalText(pool: Pool): string {
  return `${Math.round(pool.amount)}/${pool.capacity}`;
}
```

```vue
<!-- src/ui/components/VitalsStrip.vue -->
<script setup lang="ts">
/* ============================================================================
   VitalsStrip — the phone astronaut's whole colony readout (tier 2, spec §2).
   Top row: brand mark · SOL n · connection dot. Vitals row: the four survival
   pools with trend arrows, from the SAME snapshot fields the ResourceRail
   reads (pools/flow). Mounted only in the hud--phone mode by App.vue.
   ============================================================================ */
import { computed } from "vue";
import type { Resource } from "@shared/types";
import { useColony } from "../stores/colony";
import { trendOf, vitalText, type Trend } from "./vitals";

const { snapshot, netStatus } = useColony();
const s = computed(() => snapshot.value);

const ORDER: { k: Resource; glyph: string }[] = [
  { k: "power", glyph: "⚡" },
  { k: "oxygen", glyph: "O₂" },
  { k: "water", glyph: "H₂O" },
  { k: "food", glyph: "≡" },
];
const ARROW: Record<Trend, string> = { up: "▲", down: "▼", flat: "·" };
</script>

<template>
  <div v-if="s" class="vitals" aria-label="Colony vitals">
    <div class="vitals-top">
      <span class="vt-mark" aria-hidden="true">◇</span>
      <span class="vt-sol">SOL {{ s.sol }}</span>
      <span class="vt-dot" :class="netStatus" :aria-label="`connection ${netStatus}`" />
    </div>
    <div class="vitals-row">
      <span
        v-for="r in ORDER"
        :key="r.k"
        class="vt-cell"
        :class="'trend-' + trendOf(s.flow[r.k])"
      >
        <span class="vt-glyph">{{ r.glyph }}</span>
        {{ vitalText(s.pools[r.k]) }}
        <span class="vt-arrow" aria-hidden="true">{{ ARROW[trendOf(s.flow[r.k])] }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.vitals {
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 10px 6px;
  background: var(--panel);
  backdrop-filter: blur(9px);
  border-bottom: 1px solid var(--hair);
  font-family: var(--mono);
}
.vitals-top { display: flex; align-items: center; gap: 8px; }
.vt-mark { color: var(--cyan); font-size: 11px; }
.vt-sol { font-size: 10px; letter-spacing: 0.18em; color: var(--ink); }
.vt-dot { width: 7px; height: 7px; margin-left: auto; border-radius: 50%; background: var(--faint); }
.vt-dot.connected { background: #9bd6a0; box-shadow: 0 0 6px rgba(155, 214, 160, 0.7); }
.vt-dot.connecting { background: #e0b45f; }
.vt-dot.failed, .vt-dot.host-left { background: #e07a5f; }
.vitals-row { display: flex; justify-content: space-between; gap: 6px; }
.vt-cell { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--ink); white-space: nowrap; }
.vt-glyph { color: var(--dim); font-size: 10px; margin-right: 1px; }
.vt-arrow { font-size: 9px; }
.vt-cell.trend-up .vt-arrow { color: #9bd6a0; }
.vt-cell.trend-down .vt-arrow { color: #e07a5f; }
.vt-cell.trend-flat .vt-arrow { color: var(--faint); }
</style>
```

- [ ] **Step 4: Run the tests to verify green**

Run: `npx vitest run src/ui/components/vitals.test.ts` → PASS (4 tests). `npm run typecheck` → clean (the component compiles even though nothing mounts it yet).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/vitals.ts src/ui/components/vitals.test.ts src/ui/components/VitalsStrip.vue
git commit -m "feat(vivarium): vitals strip — the phone astronaut's colony readout"
```

---

### Task 4: The phone HUD mode (`hud--phone`)

**Files:**
- Modify: `src/ui/App.vue` (imports, `phoneGuest` computed, `.hud` class, VitalsStrip mount, hint-layer suppression)
- Modify: `src/ui/components/PilotBar.vue` (guest spectate banner)
- Modify: `src/ui/style/hud.css` (shed-down block, appended at the end)

**Interfaces:**
- Consumes: `belowFloor` from `src/ui/viewport.ts` (Task 2); `<VitalsStrip />` (Task 3); the store's `mode` and `netStatus` (PilotBar adds them to its existing `useColony()` destructure).
- Produces: the `hud--phone` class contract — anything styled for phones hangs off `.hud--phone` in `hud.css`.

- [ ] **Step 1: App.vue — mode plumbing**

In the `<script setup>` block: add to the imports

```ts
import VitalsStrip from "./components/VitalsStrip.vue";
import { belowFloor } from "./viewport";
```

and after the `useColony()` destructure (which already includes `mode`; add it if absent):

```ts
/** phone astronaut mode (tier 2): a connected-or-connecting guest below the
 *  560×440 floor sheds the HUD to the cockpit. Rotating above the floor simply
 *  deactivates it — both inputs are live refs. */
const phoneGuest = computed(() => belowFloor.value && mode.value === "guest");
```

In the template: the HUD root (line ~302) gains the class and the strip —

```html
<div class="hud" :class="{ 'hud--phone': phoneGuest }" v-if="ready && !startScreen">
  <VitalsStrip v-if="phoneGuest" class="phone-vitals" />
  <TopBar />
```

and the hint layer (line ~335) gains the suppression (FirstHint/HintToast teach architect controls):

```html
<div v-if="!booting && !startScreen && !phoneGuest" class="hint-layer">
```

- [ ] **Step 2: PilotBar.vue — the spectate banner**

Add `mode` and `netStatus` to the destructure:

```ts
const { snapshot, controls, capabilities, mode, netStatus } = useColony();
```

The PILOT COMMANDER button is meaningless for guests (the relay assigns suits); replace it with the spectate line. Change the `touch-enter` button's `v-if` and add the banner after it:

```html
<button
  v-if="mode !== 'guest' && capabilities.canPilot && snapshot && !pilot && !rover && snapshot.colonists.length"
  class="touch-enter"
  type="button"
  @click="controls.possessToggle()"
>
  ▶ PILOT COMMANDER
</button>
<div v-if="mode === 'guest' && netStatus === 'connected' && !pilot && !rover" class="pilot spectate">
  <span class="pilot-tag">◇ NO SUIT ASSIGNED — you take the next arrival</span>
</div>
```

And in the scoped styles, beside the existing `.pilot` rules:

```css
.pilot.spectate { border-color: rgba(127, 212, 232, 0.35); color: var(--dim); }
```

(This is deliberately not phone-gated: a tablet guest waiting for a suit gets the same honest line instead of a dead button.)

- [ ] **Step 3: hud.css — the shed-down block**

Append at the end of `src/ui/style/hud.css`:

```css
/* ---------- phone astronaut (tier 2): the cockpit ----------
   Active only for a guest below the 560×440 floor (App.vue's hud--phone).
   Everything but the vitals strip, ticker, log, and PilotBar disappears; the
   touch targets grow to thumb size. Desktop/tablet and solo are untouched. */
.hud--phone .topbar,
.hud--phone .left-col,
.hud--phone .right-col,
.hud--phone .inspect { display: none; }
.hud--phone .phone-vitals { position: absolute; top: 0; left: 0; right: 0; pointer-events: none; }
.hud--phone .bottom-center {
  left: 8px;
  right: 8px;
  bottom: calc(var(--ticker-h) + 8px);
  width: auto;
  max-width: none;
  transform: none;
}
.hud--phone .touch-move { min-width: 52px; min-height: 52px; font-size: 16px; }
.hud--phone .touch-action,
.hud--phone .touch-release { min-height: 48px; }
```

(The quad sits bottom-right and the action button bottom-left already via PilotBar's own coarse-pointer layout; landscape needs nothing extra — the same block applies.)

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test` → clean, all unit suites pass (no unit test exercises the mode — it is CSS + two `v-if`s over tested inputs).
Run: `npx playwright test` → full suite green (desktop project proves solo/tablet untouched; the phone project's console tests still pass — `hud--phone` never activates without a connected guest, which CI can't produce; that path is Task 5's live check).

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.vue src/ui/components/PilotBar.vue src/ui/style/hud.css
git commit -m "feat(vivarium): hud--phone cockpit — vitals strip, spectate banner, thumb targets"
```

---

### Task 5: Live validation, docs, ship

**Files:**
- Modify: `docs/development.md` (the co-op validation note)
- Modify: `CLAUDE.md` (one sentence in the co-op bullet)

**Interfaces:**
- Consumes: everything above; `window.__net.host(code, name)` (DEV hook, App.vue line ~262).

- [ ] **Step 1: Live two-client validation (needs internet — Nostr relays; run locally, never CI)**

Write a throwaway script in the scratchpad (not the repo) using `@playwright/test`'s `chromium` with TWO contexts against `npm run dev`:

1. **Host context** (desktop viewport 1280×800): boot to the game (`.boot` click → BEGIN → close field guide), then `page.evaluate(() => window.__net.host("<unique code>", "Architect"))`.
2. **Guest context** (`viewport 412×915, hasTouch: true`): `goto /?join=<same code>` → boot click → the Field Console shows prefilled → fill callsign → tap JOIN AS ASTRONAUT.
3. Assert, polling up to 30 s: guest page has `.vitals` visible and `.viewport-gate` hidden (gate lifted on connect); host page `evaluate` shows the guest in the roster.
4. Movement: on the guest, `locator(".touch-move.right").dispatchEvent("pointerdown")`, wait 600 ms, `dispatchEvent("pointerup")`; assert on the HOST via `expect.poll` that the guest's colonist `x` in `window.__viv.bridge.latest.colonists` moved by > 0.1 (find the colonist id from the host's roster `actorId`).
5. Kill the host context; assert the guest's Field Console returns showing `/host disconnected/i`.

Expected: all five assertions pass. If Nostr relays are unreachable, note it and hand the check to the human partner as the LAN test instead — do not ship without one of the two passing.

- [ ] **Step 2: Real-device note + docs**

In `docs/development.md`, extend the co-op validation paragraph with:

```markdown
Phone-astronaut check (tier 2): a phone-sized guest joins through the Field
Console (the ViewportGate's join fork; `?join=CODE` prefills). Emulated: two
Playwright contexts — desktop host via `__net.host`, guest at 412×915 with
`hasTouch` joining through the UI; the guest's `.vitals` strip appears, the
gate lifts, and its quad moves its colonist on the HOST's `bridge.latest`.
Real device: `npm run dev -- --host` + a phone on the same LAN pointed at
`http://<mac-ip>:5180/?join=<code>`.
```

In `CLAUDE.md`, at the end of the co-op bullet's UI sentence (`Lobby.vue (host/join by code + roster), render/three/nametags.ts …`), append:

```markdown
Below the 560×440 floor the ViewportGate is a join fork (the Field Console:
`components/fieldconsole.ts` + `ui/viewport.ts` `belowFloor`) and a connected
guest gets the `hud--phone` cockpit (VitalsStrip + PilotBar + ticker) — phones
play co-op as astronauts; founding still needs a wider console.
```

- [ ] **Step 3: Full verify**

Run: `npm run typecheck && npm test && npx playwright test`
Expected: all green. Confirm `git status` shows only the intended files.

- [ ] **Step 4: Commit and push**

```bash
git add docs/development.md CLAUDE.md
git commit -m "docs(vivarium): phone-astronaut validation recipe + co-op note"
git push origin main
```

---

## Self-Review (done at plan time)

- **Spec coverage:** §1 Field Console → Tasks 1–2 (states, form, prefill, status lines, upper-half/`100dvh`/safe-area CSS). §2 HUD → Tasks 3–4 (VitalsStrip incl. slim top row, hidden rails/hints, ≥48px targets, spectate banner, rotation fall-out via live refs). §3 wiring → Tasks 2/4. §4 non-changes → global constraints. §5 edges → gate CSS (keyboard, safe-area), spectate copy, perf note (no action). §6 testing → Task 1/3 units, Task 2 offline e2e + gate-test update, Task 5 live/manual + docs. §7 verifications → resolved during planning (`joinGame` calls `teardown()` first — App.vue:235; `netStatus` flips via `applyRoster` — App.vue:211; hint suppression kept as the explicit rule).
- **Placeholder scan:** none — every step carries the real code/copy.
- **Type consistency:** `FLOOR_QUERY`/`gateView`/`parseJoinCode`/`consoleStatus` (Tasks 1→2), `belowFloor` (2→4), `trendOf`/`vitalText`/`Trend` (3→3), `join { code, name }` payload matches `onJoin`'s existing type.
