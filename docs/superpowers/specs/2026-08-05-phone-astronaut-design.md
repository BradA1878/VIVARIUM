# Phone Astronaut (Tier 2 mobile) — design

- **Date:** 2026-08-05
- **Status:** design approved (brainstorm), spec committed; next: implementation plan
- **Origin:** mobile-friendliness assessment (2026-08-04). Tier 1 (tablet console ≥560×440: coarse-pointer HUD + two-step touch placement, shipped `5968b45`) made tablets fully playable. Tier 2 lets a **phone** — below the 560×440 floor — join a friend's colony as a **co-op astronaut**. Tier 3 (full architect play on phones) is explicitly out of scope.
- **Scope:** UI/CSS only. Zero engine, protocol, or `src/net/` changes.

## Problem

Phones hit the `ViewportGate` wall ("wider console required", <560w or <440h) and can reach nothing — including the co-op join path, which today lives inside the running game's HUD (`Lobby.vue` in the right rail). Yet everything an astronaut needs already exists:

- **Roles by construction**: `capabilities` (`stores/colony.ts:91`) strips guests to `canPilot` — no palette, no sim controls, no colony management. The host relay (`net/hostRelay.ts`) claims a free colonist per guest, attributes input, drops build commands, and re-embodies a dead guest on the next arrival.
- **Touch is done**: the PilotBar's coarse-pointer movement quad + MINE/LOAD/RELEASE/PILOT buttons shipped with the tablet console; canvas interaction is two-step tap (irrelevant to astronauts, who never build); the camera is an automatic follow-cam keyed to the guest's actor via `BridgeCore.localActor`.
- **Connection UX exists**: `NetStatus` (`idle | connecting | connected | failed | host-left`) already drives the Lobby's status lines.
- A guest **runs no worker** and renders the host's snapshots through the same renderer; `PerfGovernor` AUTO ladders phone GPUs down.

So Tier 2 is an **entry path + a shed-down HUD**, not a networking or engine feature.

## Core decision: the gate becomes a fork

On below-floor viewports the `ViewportGate` stops being a wall and becomes the **Field Console**: the same card explains that *founding* a colony needs a wider console, then offers callsign + room code + JOIN AS ASTRONAUT. Joining reuses the exact `joinGame` path the Lobby emits into.

- Rejected: **phone-capable StartScreen** (strip difficulty/founding/continue down to the co-op section) — a much larger component to conditionally gut, the gate still exists behind it for in-game states, and it produces the same player-visible outcome as the fork.
- Rejected: **separate join shell** (skip booting the solo world entirely) — cleanest battery story, but the app's lifecycle assumes `startLocal()` on mount, and the join swap already tears the local side down; the biggest structural change for the same outcome.
- Chosen: **fork** — smallest surface, direct URL→playing path, and the invite-link bonus (`?join=CODE` prefills the room code) falls out of it.

## Design

### 1. Field Console (ViewportGate fork)

One shared source of truth for "below the floor": a `belowFloor` ref driven by `matchMedia("(max-width: 559px), (max-height: 439px)")` in a small composable — the same query the gate's CSS uses today. The gate's visibility becomes reactive (`v-if`-style) instead of CSS-only, because it now must also **lift while a guest session is live**.

Gate states (mutually exclusive, in priority order):

1. `!belowFloor` → hidden (unchanged desktop/tablet behavior).
2. `belowFloor && mode === "guest" && netStatus === "connected"` → hidden — the phone HUD owns the screen.
3. `belowFloor` otherwise → the Field Console card:
   - Copy: "Founding a colony needs at least a 560×440 console. **Joining one works right here.**" + the existing "your colony save remains intact" reassurance and a "solo → laptop/tablet" footer.
   - Form: callsign (maxlength 16, default "Astronaut") + room code (maxlength 24, required), mirroring `Lobby.vue`'s fields; submit emits `join{code,name}` → App.vue's existing `joinGame`.
   - `?join=CODE` in the URL prefills the code field (parsed once at mount with `URLSearchParams`, same 24-char clamp). A host can text `https://…?join=marsbase`.
   - Status line rendered from `netStatus`: `connecting` → "Connecting to the host…"; `failed` → "No host answered — check the code and try again."; `host-left` → "Host disconnected. Rejoin with the same code."; submit disabled while `connecting`.
   - The form sits in the **upper half** of the card so the phone keyboard never covers the active input; the card scrolls within `100dvh` if it must.

Disconnection mid-session (`host-left`/`failed`) drops state 2 → the Field Console returns with the warning line and the last code still filled. The solo world behind the gate is whatever the join swap left; phones never expose it.

### 2. Phone astronaut HUD

Active when `belowFloor && mode === "guest"` (a `hud--phone` mode on the existing `.hud`, not a parallel component tree — PilotBar, ticker, and the log stay the same singleton instances).

Shown:
- **Slim top bar**: brand mark, sol clock digits, a connection dot (green `connected` / amber `connecting` / red `failed|host-left`). No storm/reset/pause/speed — guests never had those controls (`canManageSimulation` false); this is layout, not new gating.
- **VitalsStrip** (new, dumb): one line — power / O₂ / water / food, each "current value + trend arrow" from the same snapshot fields `ResourceRail` reads. The astronaut's loop is hauling; the strip is where a haul visibly lands.
- **NarratorTicker** at the bottom edge (tap opens `LogOverlay`, as today).
- **PilotBar** above the ticker: the existing touch quad + context action + RELEASE/PILOT buttons, with hit targets enlarged to ≥48px on the phone layout. Portrait: quad bottom-right thumb zone, action button bottom-left. Landscape: same pieces, quad right, action left.
- **Spectate banner** replacing the PilotBar body when connected with no assigned actor (`snapshot.possessed == null` for this client): "no suit assigned — you take the next arrival." Covers both the pre-claim wait and death-→-re-embody; the relay already implements the behavior.

Hidden: left rail (clock/resources/crew/objective), right rail (alien tech, alerts stack, trade/launch/colonies — already capability-hidden — and the Lobby panel; the connection dot replaces it), Inspector, Palette (already hidden), FirstHint/HintToast (they teach architect controls; suppressed for phone guests).

Rotating above the floor mid-session simply deactivates `hud--phone` → the normal tablet guest HUD returns. No special casing; both states derive from the same two refs.

### 3. App wiring

- `App.vue`: mount the gate's join event to `joinGame` (one line beside the Lobby's); compute `phoneGuest = belowFloor && mode === "guest"`; apply `hud--phone`; suppress the hint layer on `phoneGuest`.
- The gate needs `mode`/`netStatus` from the store — it already imports nothing; it gains the same `useColony()` access every HUD panel uses.
- No store API changes: `joinGame`, `mode`, `netStatus`, `roster` all exist.

### 4. What does not change

The engine, `worker/protocol.ts`, `worker/host.ts`, `src/net/*` (room, hostRelay, netBridge), persistence, and the renderer. The wall holds by construction: this feature only *observes* (`snapshot`, `netStatus`) and emits the existing `joinGame`. Solo and desktop/tablet co-op are byte-identical — every new behavior is gated behind `belowFloor && guest`.

### 5. Edges

- **Pinch-zoom** stays enabled off-canvas (accessibility); the canvas already owns its gestures (`touch-action: none`).
- **Perf**: no forced quality floor — `PerfGovernor` AUTO converges on phone GPUs; revisit only if real-device QA shows it hunting.
- **Audio**: the join tap is a real gesture, so the AudioContext unlock works as on desktop.
- **Safe areas**: the HUD layer already insets by `env(safe-area-inset-*)` (Tier 1); the Field Console card adds the same insets to its padding.
- **Trystero needs internet** (Nostr signalling) — the `failed` state is the offline story; no new handling.

### 6. Testing

- **Unit** (`components/*.ts` + test pattern, like `guide.ts`/`keyboard.ts`): extract the Field Console's pure logic — gate-state priority (the 3-state table above), `?join=` parsing/clamping, status-line mapping — into `fieldconsole.ts` with tests. VitalsStrip's value/trend formatting likewise.
- **e2e, offline** (phone project, no network dependency): below-floor shows the Field Console with the join form; `?join=marsbase` prefills; submit flips to "Connecting…" and then the `failed` state (no host answers — a real, assertable offline path); rotating to 800×600 restores the tablet start path. The existing gate test's overflow assertion extends to the form state.
- **Manual, documented** (in `docs/development.md`'s co-op note): full loop via two browser contexts — desktop host (`__net.host`) + phone-emulated guest joining through the Field Console UI; guest quad movement must move its colonist on the **host's** `bridge.latest`. Real-device pass: `npm run dev -- --host` + a phone on the same LAN.

### 7. Implementation-time verifications (expected answers, to confirm before coding)

1. `joinGame` tears down the local worker / solo bridge on swap (CLAUDE.md: "a guest runs no worker") — expected yes; if not, the swap must, or phones idle a hidden worker.
2. After `joinGame`, `startScreen` state clears so the HUD (not the StartScreen) is what the lifted gate reveals — expected yes via the existing guest flow.
3. FirstHint/HintToast visibility for guests — if already capability-gated, the suppression in §3 is a no-op; keep it anyway as the explicit phone rule.

## Non-goals

- Architect/founding/solo play on phones (Tier 3).
- Virtual joystick (the quad ships; joystick is later polish if real-device QA wants it).
- Roster UI, chat, or spectate camera controls on the phone HUD.
- Host-side changes of any kind.
