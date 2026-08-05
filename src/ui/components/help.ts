import { ref } from "vue";
import { closeGuide, openGuide, type GuideProgress } from "./guide";

/** The reusable reference panel is intentionally separate from the live Field Guide. */
export const helpOpen = ref(false);

export type FieldGuideIntent = "start" | "resume" | "replay";

export interface FieldGuideHelpRequest {
  id: number;
  intent: FieldGuideIntent;
}

/**
 * FirstHint can watch this signal when it needs to distinguish a normal reopen
 * from an explicit replay request. The id makes repeated requests observable.
 */
export const fieldGuideHelpRequest = ref<FieldGuideHelpRequest | null>(null);
let fieldGuideRequestId = 0;

export function openHelp(): void {
  closeGuide();
  helpOpen.value = true;
}

export function closeHelp(): void {
  helpOpen.value = false;
}

export function toggleHelp(): void {
  if (helpOpen.value) closeHelp();
  else openHelp();
}

export function fieldGuideIntentFor(
  progress: Pick<GuideProgress, "stage"> | null,
  legacyGuideSeen = false,
): FieldGuideIntent {
  if (progress?.stage === "complete" || (!progress && legacyGuideSeen)) return "replay";
  if (progress) return "resume";
  return "start";
}

/** Leave the reference panel for the live, state-aware tutorial. */
export function requestFieldGuideFromHelp(intent: FieldGuideIntent): void {
  closeHelp();
  fieldGuideHelpRequest.value = { id: ++fieldGuideRequestId, intent };
  openGuide();
}
