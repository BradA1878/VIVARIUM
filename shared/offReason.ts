/* The label each reason a building is off wears — on its badge, its card, and
   the hover chip. Display copy shared by the renderer and the UI. */
import type { OffReason } from "./types";

export const OFF_REASON_LABEL: Record<OffReason, string> = {
  power: "NO POWER",
  damaged: "DAMAGED",
  faulted: "FLARE FAULT",
  seal: "NO SEAL",
  crew: "NO CREW",
  water: "NO WATER",
  oxygen: "NO OXYGEN",
  food: "NO FOOD",
  off: "OFF",
};
