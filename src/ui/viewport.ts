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
