import { fmt } from "@/ui/format";

export interface ResupplyAlertCopy {
  txt: string;
  sub: string;
}

export function resupplyAlertCopy(secondsRemaining: number): ResupplyAlertCopy {
  return {
    txt: "EARTH RESUPPLY — AUTOMATIC",
    sub: `no action required · adding power, water, oxygen, and food · departs in ${fmt(secondsRemaining)}s`,
  };
}
