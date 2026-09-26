import type { BuildingState, OffReason } from "@shared/types";
import { DEFS } from "@/engine";
import { fmt } from "@/ui/format";

export interface ResupplyAlertCopy {
  txt: string;
  sub: string;
}

/** Quakes can hit the sealed infrastructure that crew shelter beside. Keep the
 * human cost in the live warning instead of hiding it in event-log flavor. */
export function quakeAlertSub(secondsRemaining: number, incoming: boolean): string {
  const countdown = incoming
    ? `impact in ${fmt(secondsRemaining)}s`
    : `${fmt(secondsRemaining)}s remaining`;
  return `crew evacuating · release any pilot to shelter · exposed crew can be injured · seals at risk · ${countdown}`;
}

export function resupplyAlertCopy(secondsRemaining: number): ResupplyAlertCopy {
  return {
    txt: "EARTH RESUPPLY — AUTOMATIC",
    sub: `no action required · adding power, water, oxygen, and food · departs in ${fmt(secondsRemaining)}s`,
  };
}

/** load shedding: a sealed building went dark because the grid could not
 *  power it. Reads the engine's reason, so a damaged or flare-faulted building
 *  (offline, yet connected, staffed, and fed) is not taken for a brownout. */
export function brownoutShed(buildings: readonly BuildingState[]): boolean {
  return buildings.some((b) => !!DEFS[b.defId]?.requiresPressure && b.offReason === "power");
}

export interface FaultAlert {
  k: string;
  sev: 2;
  txt: string;
  sub: string;
  uids: number[];
}

/** off-reasons this alert covers, in the order the lines are listed. Power is
 * left out: the existing BROWNOUT alert already covers it. */
type FaultReason = Exclude<OffReason, "power">;
const FAULT_ORDER: readonly FaultReason[] = ["seal", "crew", "damaged", "faulted", "water", "oxygen", "food"];

const FAULT_COPY: Record<FaultReason, { label: string; sub: string }> = {
  seal: { label: "UNSEALED", sub: "no corridor to a hub" },
  crew: { label: "UNSTAFFED", sub: "no free crew" },
  // not "offline": a damaged solar array, tank, or hub keeps working (integrity
  // repairs itself at a fixed rate either way)
  damaged: { label: "DAMAGED", sub: "repairs itself over time" },
  faulted: { label: "FLARE FAULT", sub: "electronics recovering" },
  water: { label: "NO WATER", sub: "input tank empty" },
  oxygen: { label: "NO OXYGEN", sub: "input tank empty" },
  food: { label: "NO FOOD", sub: "input tank empty" },
};

/** One HUD line per off-reason, each carrying the uids of every affected
 * building so a click can cycle through them (doc: pressure network design
 * §7). Conduits are excluded (a brownout should not badge every corridor
 * cell), and so is "power" (BROWNOUT already reports it). Lines are listed
 * in a fixed severity order and only when their count is above zero. */
/** the building a fault line shows next: the first after the one shown last,
 *  in building order, wrapping. Keyed on the uid rather than an index, so a
 *  building fixed or added between clicks never repeats or skips one. */
export function nextFaultUid(uids: readonly number[], last: number | undefined): number | undefined {
  if (uids.length === 0) return undefined;
  if (last === undefined) return uids[0];
  return uids.find((u) => u > last) ?? uids[0];
}

export function faultAlerts(buildings: readonly BuildingState[]): FaultAlert[] {
  const uidsByReason = new Map<FaultReason, number[]>();
  for (const b of buildings) {
    if (DEFS[b.defId]?.conduit) continue;
    const reason = b.offReason;
    if (!reason || reason === "power") continue;
    const uids = uidsByReason.get(reason);
    if (uids) uids.push(b.uid); else uidsByReason.set(reason, [b.uid]);
  }
  const out: FaultAlert[] = [];
  for (const reason of FAULT_ORDER) {
    const uids = uidsByReason.get(reason);
    if (!uids || uids.length === 0) continue;
    const { label, sub } = FAULT_COPY[reason];
    out.push({ k: "off-" + reason, sev: 2, txt: `${uids.length} ${label}`, sub, uids });
  }
  return out;
}
