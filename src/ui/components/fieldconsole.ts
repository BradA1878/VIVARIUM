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
