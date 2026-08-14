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
