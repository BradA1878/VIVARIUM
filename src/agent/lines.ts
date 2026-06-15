/* ============================================================================
   VIVARIUM's scripted line banks — the cheap public-build voice (doc §3.2, §4.5).
   No LLM, no network. Keyed by event type; some keyed further by resource.

   The register, to preserve absolutely: dry telemetry with fingerprints. Lines
   are status reports — what changed, the key number, what the system is doing
   about it — in short declarative clauses. Plain words, concrete rounded
   numbers, no metaphor, no poetry. VIVARIUM's one allowance is a single dry
   aside. Every line fits in 140 characters after placeholder stripping (the
   register guard in council.test.ts enforces it).
   ============================================================================ */
import type { Difficulty, EventType } from "@shared/types";

/** severity drives the gate; higher speaks through cooldowns (doc §3.1) */
export const SEV: Record<EventType, number> = {
  casualty: 5, crit_start: 4, storm_in: 3, brownout: 3, hub_online: 3,
  crit_clear: 2, power_back: 2, arrival: 2, storm_clear: 2, resupply: 2,
  resupply_done: 1, // the window closed — a quiet confirmation of what landed
  dusk: 1, dawn: 1, new_sol: 1, build: 0, boot: 0,
  anomaly: 3, // agent-originated (Sentinel); only the Watcher has a bank for it
  victory: 6, defeat: 6, expansion: 6, // campaign end — the Chronicler speaks, through anything
  hazard_warn: 3, hazard_start: 2, hazard_end: 1,
  strike: 0, building_damaged: 2, building_destroyed: 4,
  traders_inbound: 3, trade_done: 2, trade_left: 1, // first contact
  ufo_inbound: 4, abducted: 5, abduction_blocked: 3, ufo_left: 1, // the abductor
  birth: 2, // the colony grows from within
  unlock: 2, // a gated def opens for placement
  rover_ready: 2, // the Rover Bay rolls one out
  robot_ready: 2, robot_destroyed: 3, // the Robotics Bay's fleet (loss is the Watcher's)
  morale_low: 3, morale_recovered: 1, // the colony's mood (latched, like brownout)
  colonist_injured: 2, colonist_recovered: 1, // strike wounds + the medbay loop
  idle: 0, // agent-originated (council banter); never competes with a real beat
};

type Bank = string[] | Record<string, string[]>;

export const LINES: Partial<Record<EventType | "boot", Bank>> = {
  boot: [
    "VIVARIUM online. 4 colonists, 55 seconds of grace, one battery. Build power first.",
    "Kernel up. 4 colonists, 60 stored power, solar only. Begin construction.",
  ],
  hub_online: [
    "Hub sealed. Interior pressure holding. Life support is online.",
  ],
  build: [
    "Structure registered. Power and supply ledgers updated.",
    "New building on the grid. I am adding it to the watch list.",
  ],
  dawn: [
    "Sunrise. Arrays ramping to full. Battery draw ends.",
    "Dawn. Solar input climbing. I am recharging what the night spent.",
  ],
  dusk: [
    "Sunset. Solar output falling to zero. Switching to stored power.",
    "Dusk. Arrays offline until dawn. The batteries carry the colony now.",
  ],
  new_sol: [
    "Sol {sol}. All colonists accounted for. Resuming the watch.",
    "Sol {sol} begins. Counts unchanged overnight. Logged.",
  ],
  storm_in: [
    "Dust storm inbound. {secs} seconds. Solar output will drop by up to 88 percent.",
    "Storm front detected. Contact in {secs} seconds. I am dimming nonessential rooms.",
  ],
  storm_clear: [
    "Storm passed. Dust clearing. Solar output recovering to normal.",
  ],
  brownout: [
    "Demand exceeds supply. Shedding lowest priority first. Forgive the dark rooms.",
    "Power deficit. I am cutting nonessential rooms until supply recovers.",
  ],
  power_back: [
    "Supply exceeds demand again. Restoring shed rooms in priority order.",
  ],
  crit_start: {
    oxygen: ["Oxygen at zero. Production short of demand. The grace timer is running. Fix the source."],
    water: ["Water at zero. Draw exceeds production. The dehydration timer is running."],
    food: ["Food stores at zero. Rationing has nothing left to ration. The timer is running."],
  },
  crit_clear: {
    oxygen: ["Oxygen recovering. Reserve above zero and climbing. Timer cleared."],
    water: ["Water restored. Production exceeds draw again. Timer cleared."],
    food: ["Food back in stores. Reserve above zero. The hunger timer is cleared."],
  },
  casualty: {
    oxygen: ["One colonist stopped breathing. Cause: oxygen at zero. Count is lower."],
    water: ["One colonist lost. Cause: water at zero. I have updated the count."],
    food: ["One colonist lost to starvation. Cause: food at zero. Count is lower."],
    // a strike death carries no res — the detail key "strike" routes here
    strike: [
      "One colonist lost at the impact site. Cause: strike. I logged the exact second.",
      "Casualty at the impact point. Cause: strike, not life support. Count is lower.",
    ],
  },
  arrival: [
    "Transport down. 4 new colonists. Life-support demand up by 4. I am rebalancing.",
    "Arrival complete. Population up by 4. Oxygen and water budgets recalculated.",
  ],
  resupply: [
    "Resupply window open. Earth shipment received. Tanks topping up to capacity.",
    "Supply drop landed. I am transferring cargo to stores. Overflow is vented, regrettably.",
  ],
  traders_inbound: [
    "Unidentified craft descending. Not an Earth resupply. Intent reads as trade.",
    "Nonhuman vessel on approach. It is signaling an exchange. First contact logged.",
    "Traders landed. They carry {detail}. Offer on screen. The window is short.",
  ],
  trade_done: [
    "Trade complete. Pools updated on both sides. First exchange with a nonhuman party logged.",
    "Exchange accepted. Cargo transferred. The ledger records a fair deal.",
  ],
  trade_left: [
    "Trader craft departed. Sky clear. Trade window closed.",
    "The visitors lifted off. No further offers this pass. Logged.",
  ],
  ufo_inbound: [
    "Unknown craft descending fast. Not a trader profile. It is tracking a colonist.",
    "Hostile contact inbound. Trajectory locked on the colony. I cannot intercept it.",
  ],
  abducted: [
    "Colonist taken by the craft. I logged the exact second. Population count is lower.",
    "Abduction confirmed. One colonist lifted off-surface. I could not stop it.",
  ],
  abduction_blocked: [
    "Abduction attempt failed. The deflector field held. Keep it powered.",
    "Beam deflected. Zero colonists taken. The field drew heavy power and earned it.",
  ],
  ufo_left: [
    "The craft is gone. Sky clear. I am keeping its signature on file.",
  ],
  birth: [
    "Birth logged. Population up by one. Born on Mars, not sent from Earth.",
    "Sol {sol}. One new colonist, born in-colony. Demand ledgers updated.",
  ],
  unlock: [
    "Schematic decoded: {detail}. It is on the palette now.",
    "New blueprint online: {detail}. Build it when power allows.",
  ],
  rover_ready: [
    "Rover fabricated. Parked at the bay. Stand near it and press F to drive.",
    "Rover ready by the bay door. Press F beside it to take the controls.",
  ],
  robot_ready: [
    "Mining robot online. Rolling out from the bay. It gathers without rest.",
    "Robot fabricated. One more set of hands that does not breathe. Assigned to gathering.",
  ],
  morale_low: [
    "Morale below threshold. Work speed measurably down. They need a quiet sol.",
    "Mood index low. Output sagging with it. I can filter air, not fear.",
    "Morale critical. Efficiency dropping. Give them light, full plates, one sol without sirens.",
  ],
  morale_recovered: [
    "Morale recovered. Work speed back to baseline. Logged.",
    "Mood index back above the line. Output normal. I am standing down the worry.",
  ],
  colonist_injured: [
    "One colonist injured. Movement impaired. Route them to the medbay.",
    "Injury logged. One colonist down, not dead. Medbay flagged on their path.",
    "Injury report: one colonist hurt. They will limp until treated. I lit the route.",
  ],
  colonist_recovered: [
    "Treatment complete. One colonist back to full speed. Medbay clear.",
    "Recovery logged. Gait reads normal. I checked twice.",
  ],
};

/** the council's first words — the send-off bends to the chosen difficulty */
const BOOT_EASY: string[] = [
  "VIVARIUM online. Easy site: generous sun, slow hazards. 4 colonists. Build power first.",
  "Kernel up. The margins here are wide. Take the time to build them wider.",
];
const BOOT_HARD: string[] = [
  "VIVARIUM online. Hard site: thin margins, fast hazards. 4 colonists. Waste nothing.",
  "Kernel up. This site has ended colonies before. Build power, then storage, fast.",
];

export function bootLines(difficulty?: Difficulty): string[] {
  if (difficulty === "easy") return BOOT_EASY;
  if (difficulty === "hard") return BOOT_HARD;
  return LINES.boot as string[];
}
