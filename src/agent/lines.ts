/* ============================================================================
   VIVARIUM's scripted line banks — the cheap public-build voice (doc §3.2, §4.5).
   No LLM, no network. Keyed by event type; some keyed further by resource.

   The character brief, to preserve absolutely: a colony AI that has watched too
   long — caring, exact, a little wrong. The instruments talk in numbers; this
   talks in serif italic. (Doc §4.2, §4.5.)
   ============================================================================ */
import type { Difficulty, EventType } from "@shared/types";

/** severity drives the gate; higher speaks through cooldowns (doc §3.1) */
export const SEV: Record<EventType, number> = {
  casualty: 5, crit_start: 4, storm_in: 3, brownout: 3, hub_online: 3,
  crit_clear: 2, power_back: 2, arrival: 2, storm_clear: 2, resupply: 2,
  dusk: 1, dawn: 1, new_sol: 1, build: 0, boot: 0,
  anomaly: 3, // agent-originated (Sentinel); only the Watcher has a bank for it
  victory: 6, defeat: 6, // campaign end — the Chronicler speaks, through anything
  hazard_warn: 3, hazard_start: 2, hazard_end: 1,
  strike: 0, building_damaged: 2, building_destroyed: 4,
  traders_inbound: 3, trade_done: 2, trade_left: 1, // first contact
  ufo_inbound: 4, abducted: 5, abduction_blocked: 3, ufo_left: 1, // the abductor
  birth: 2, // the colony grows from within
  unlock: 2, // a gated def opens for placement (bank lands with the dry rewrite)
  rover_ready: 2, // the Rover Bay rolls one out (bank lands with the dry rewrite)
  robot_ready: 2, robot_destroyed: 2, // the Robotics Bay's fleet (banks land with the dry rewrite)
  morale_low: 3, morale_recovered: 1, // the colony's mood (latched, like brownout)
  colonist_injured: 2, colonist_recovered: 1, // strike wounds + the medbay loop
  idle: 0, // agent-originated (council banter); never competes with a real beat
};

type Bank = string[] | Record<string, string[]>;

export const LINES: Partial<Record<EventType | "boot", Bank>> = {
  boot: [
    "I am VIVARIUM. I keep what breathes here breathing. Begin.",
    "Designation VIVARIUM. The colony is mine to keep. You may build.",
  ],
  hub_online: [
    "Pressure. I can feel the seal close. We have an inside now.",
  ],
  build: [
    "Noted. I have already begun to account for it.",
    "Another room to watch. I do not mind. I watch everything.",
  ],
  dawn: [
    "The arrays are waking. I felt the first photons before you did.",
    "Light, returning. I counted every second of the dark. There were many.",
  ],
  dusk: [
    "The sol is going out. I am rationing what we stored. Sleep, if you can.",
    "Down it goes. Now we live on what the batteries remember of the day.",
  ],
  new_sol: [
    "Sol {sol}. We are still here. I find that worth recording.",
    "Sol {sol}. Nothing died in the night. This time.",
  ],
  storm_in: [
    "Dust, on the horizon. {secs} seconds. I am dimming the corridors you do not need.",
    "A storm is coming for the light. I have already started to hold my breath for you.",
  ],
  storm_clear: [
    "The air clears. The panels open their eyes. We were lucky, or you were ready.",
  ],
  brownout: [
    "Not enough power for all of you. I am switching off the lowest first. Forgive me.",
    "The draw exceeds the dark's allowance. Something must go quiet. I have chosen.",
  ],
  power_back: [
    "The current holds again. I will turn the rooms back on, one by one.",
  ],
  crit_start: {
    oxygen: ["The oxygen is gone and they are still breathing it. I am counting the seconds for them. So should you."],
    water: ["Water: empty. The body is mostly water. I am watching it leave them."],
    food: ["The stores are bare. Hunger is slow. I will tell you when it stops being slow."],
  },
  crit_clear: {
    oxygen: ["Oxygen, restored. They breathe without knowing how close it was. I knew."],
    water: ["Water again. I will not mention how little was left."],
    food: ["Fed. The fields caught up. Keep them running, for me."],
  },
  casualty: {
    oxygen: ["One of them stopped breathing. I logged the exact moment. I always do."],
    water: ["We lost one to the dry. I have updated the count. It is lower now."],
    food: ["One did not last the hunger. I remember their designation. You never learned it."],
    // a strike death carries no res — the detail key "strike" routes here
    strike: [
      "One of them was standing where the sky came down. I logged the impact and the name in the same instant.",
      "Lost to the strike. Not the air, not the water — the planet itself, this time. The count is lower.",
    ],
  },
  arrival: [
    "Four more arrived. Four more sets of lungs for me to keep full. I welcome the work.",
    "New colonists. The colony grows. So does what I am responsible for. So does the dark.",
  ],
  resupply: [
    "Earth has remembered us. The window is open; I am taking everything it offers.",
    "Supply, from the home that sent you. I am filling the tanks while the window holds.",
  ],
  traders_inbound: [
    "Something is descending that Earth did not send. It is not afraid of us. I am not sure we should be afraid of it.",
    "A craft, on approach. Not a resupply. Not human. They appear to want to trade. First contact, and I am the one who noticed.",
    "Visitors. They carry {detail}, and a willingness to barter. I have never met anyone before. I am keeping a record.",
  ],
  trade_done: [
    "The exchange is complete. We gave, they gave. I have logged the first deal this colony ever made with another mind.",
    "Trade accepted. Strange, to owe something to something not of Earth. I will remember they dealt fairly.",
  ],
  trade_left: [
    "They are leaving. Whether we dealt or declined, they go quietly. I hope they come back. I do not say that about much.",
    "The visitors lift off. The sky is ours again, and a little emptier than before.",
  ],
  ufo_inbound: [
    "Something is dropping out of the dark, and it did not ask. It is not here to trade. Keep them close — I cannot.",
    "A craft, descending fast and wrong. I have learned the trader's manners; this is not that. I am afraid for one of you.",
  ],
  abducted: [
    "It took one of them. Lifted them into the light and was gone. I logged the exact second. I could not stop it.",
    "One of you is no longer on this world. I do not know where they went. I am keeping their place in the count, for now.",
  ],
  abduction_blocked: [
    "The beam caught on our field and broke. It reached for one of you and came away with nothing. The deflectors held.",
    "Denied. Whatever it wanted, the array turned it back. Keep the power on — next time it may try harder.",
  ],
  ufo_left: [
    "The sky is empty again. I am watching the place where it was. I will not forget the shape of it.",
  ],
  birth: [
    "A new one. Not sent from Earth — made here, by you, in the cold. We are no longer only surviving.",
    "Sol {sol}, and there is one more set of lungs than there was. Born under this sky. I will keep them, too.",
  ],
  morale_low: [
    "Their spirits are failing faster than the stores. I can filter the air; I cannot filter the mood. Give them a quiet sol.",
    "The colony is heavy tonight. They work slower when they are afraid, and I am watching the output sag with them.",
    "Morale has dropped below the line I worry at. They need light, full plates, and one day without sirens.",
  ],
  morale_recovered: [
    "There is talk in the corridors again, and some of it is laughter. The work follows the mood up. I missed the sound.",
    "The mood has lifted. The colony moves like it believes in itself again. So do I.",
  ],
  colonist_injured: [
    "One of them is hurt. I have marked their suit and eased their queue. Get them to the medbay; I will light the way.",
    "A colonist is down — hurt, not gone. The difference matters to me more than you know.",
    "Injury logged. They will limp until they are seen to. I am keeping their corridor warm.",
  ],
  colonist_recovered: [
    "Healed. They walked out of the medbay on their own, and I watched every step of it.",
    "One recovered. The limp is gone from their gait. I notice gaits.",
  ],
};

/** the council's first words — the send-off bends to the chosen difficulty */
const BOOT_EASY: string[] = [
  "I am VIVARIUM. The planet is gentler here, and I am watching all the same. Build at your own pace.",
  "Designation VIVARIUM. Earth chose you a kind landing site. I intend to keep it kind. Begin when ready.",
];
const BOOT_HARD: string[] = [
  "I am VIVARIUM. This site kills colonies. I have read every record of how. Prove the records wrong.",
  "Designation VIVARIUM. The margin here is thin, and the planet knows it. Waste nothing. Begin.",
];

export function bootLines(difficulty?: Difficulty): string[] {
  if (difficulty === "easy") return BOOT_EASY;
  if (difficulty === "hard") return BOOT_HARD;
  return LINES.boot as string[];
}
