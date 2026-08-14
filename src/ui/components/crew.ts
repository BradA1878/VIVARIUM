export interface CrewInjurySummary {
  count: number;
  label: string;
  status: string;
}

/** A compact, text-complete injury readout for the narrow HUD rail. */
export function crewInjurySummary(
  colonists: readonly { injury: number }[],
): CrewInjurySummary | null {
  const count = colonists.reduce((total, colonist) => total + (colonist.injury > 0 ? 1 : 0), 0);
  if (count === 0) return null;
  return {
    count,
    label: `${count} WOUNDED`,
    status: "OFF SHIFT · MED-BAY SPEEDS RECOVERY",
  };
}
