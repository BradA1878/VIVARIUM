/* ============================================================================
   World-model public surface. The agents reason over this. The in-memory store
   is the v1 the doc calls for (snapshot-into-prompt); the WorldStore interface
   is the seam where a Memgraph-backed store drops in later (doc §3.3) once the
   agent layer wants a persistent causal/temporal model across sols.
   ============================================================================ */
import type { Resource, Snapshot } from "@shared/types";
import { DEFS } from "@/engine";
import {
  buildGraph, diagnoseShortfall, producersOf, consumersOf,
  type Diagnosis, type WorldGraph,
} from "./graph";

export * from "./graph";

const LIFE = ["oxygen", "water", "food", "power"] as const;

export interface RiskItem {
  resource: Resource;
  /** seconds until empty at the current net flow */
  etaSeconds: number;
  /** what stops working when this pool bottoms out */
  dependents: string[];
}

export interface WorldStore {
  graph(s: Snapshot): WorldGraph;
  diagnose(s: Snapshot, res: Resource): Diagnosis;
  risks(s: Snapshot): RiskItem[];
}

/** Pools draining toward empty, and the buildings + crew that depend on them. */
export function risks(s: Snapshot): RiskItem[] {
  const out: RiskItem[] = [];
  for (const r of LIFE) {
    const net = s.flow[r];
    if (net >= -0.05) continue;
    const eta = s.pools[r].amount / -net;
    if (eta > 240) continue; // only near-term risk
    const dependents = consumersOf(s, r).map((b) => DEFS[b.defId].name);
    if (r !== "power") dependents.push("the colonists");
    out.push({ resource: r, etaSeconds: eta, dependents });
  }
  return out.sort((a, b) => a.etaSeconds - b.etaSeconds);
}

/** Flatten a diagnosis into a compact causal phrase the narrator can speak from:
 *  "oxygen is failing — electrolysis is starved of water — water is failing —
 *   the ice extractor lost power — the storm has taken the light." */
export function summarizeDiagnosis(d: Diagnosis): string[] {
  const chain: string[] = [];
  let cur: Diagnosis | undefined = d;
  let guard = 0;
  while (cur && guard++ < 6) {
    if (cur.noProducer) {
      chain.push(`nothing makes ${cur.resource}`);
    } else if (cur.environmental) {
      chain.push(cur.environmental === "storm" ? "the storm has taken the light" : "the dark has taken the light");
      break;
    } else {
      const f = cur.failing[0];
      if (f) {
        const why =
          f.reason === "starved" && f.starvedOf ? `is starved of ${f.starvedOf}`
          : f.reason === "unsealed" ? "has lost its seal"
          : f.reason === "unstaffed" ? "stands without hands"
          : f.reason === "unpowered" ? "has gone dark"
          : "falters";
        chain.push(`${cur.resource}: the ${f.name.toLowerCase()} ${why}`);
      } else if (cur.demandExceedsSupply) {
        chain.push(`${cur.resource}: the draw outpaces what we make`);
      }
    }
    cur = cur.upstream;
  }
  return chain;
}

/** The default in-memory store (the doc's v1; Memgraph adapter implements this). */
export const worldStore: WorldStore = {
  graph: buildGraph,
  diagnose: (s, res) => diagnoseShortfall(s, res),
  risks,
};

export { producersOf, consumersOf };
