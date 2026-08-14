import type { DefeatCause, Outcome, Pool, Resource } from "@shared/types";

export interface EndReportState {
  outcome: Outcome;
  outcomeReason: string;
  defeatCause: DefeatCause | null;
  pools: Record<Resource, Pool>;
  timers: Record<"oxygen" | "water" | "food", number | null>;
}

export interface EndCopy {
  subline: string;
  epitaph: string;
}

const RESOURCE_NAME: Record<"oxygen" | "water" | "food", string> = {
  oxygen: "oxygen reserve",
  water: "water reserve",
  food: "food supply",
};

function allReservesAboveZero(s: EndReportState): boolean {
  return (Object.values(s.pools) as Pool[]).every((pool) => pool.amount > 0.001);
}

function defeatCopy(s: EndReportState, cause: DefeatCause): EndCopy {
  switch (cause.type) {
    case "window":
      return {
        subline: "The launch window closed before the colony could stand on its own.",
        epitaph: "Time ran out with the colony still short of standing alone.",
      };
    case "resource": {
      const resource = RESOURCE_NAME[cause.resource];
      return {
        subline: `The ${resource} was exhausted before the crew could recover.`,
        epitaph: `The final crew member was lost after the ${resource} reached zero.`,
      };
    }
    case "strike": {
      const event = cause.hazard === "quake" ? "marsquake" : "meteor";
      return {
        subline: `The final crew member was lost to a ${event} strike.`,
        epitaph: allReservesAboveZero(s)
          ? `A ${event} strike claimed the final crew member. All resource reserves remained above zero.`
          : `A ${event} strike claimed the final crew member before the colony could recover.`,
      };
    }
    case "unknown":
      return {
        subline: "The final crew member was lost. Only the record remains.",
        epitaph: "The record could not establish a single terminal cause.",
      };
  }
}

/** Exact, non-inferential copy for the final frame. A legacy defeat without a
 *  typed cause gets a neutral explanation instead of inventing a failure. */
export function endCopy(s: EndReportState): EndCopy {
  if (s.outcome === "victory") {
    return {
      subline: "It needs Earth no longer. The watch holds.",
      epitaph: "The colony learned to breathe on its own.",
    };
  }
  if (s.outcome === "expansion") {
    return {
      subline: "This colony stands on its own. Choose where the work continues.",
      epitaph: "The pod cleared the gravity well. This colony stands; the work goes on elsewhere.",
    };
  }
  const cause = s.defeatCause
    ?? (s.outcomeReason === "window" ? { type: "window" as const } : { type: "unknown" as const });
  return defeatCopy(s, cause);
}
