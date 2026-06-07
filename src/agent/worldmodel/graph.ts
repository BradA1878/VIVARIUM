/* ============================================================================
   The causal/temporal world model (doc §3.3) — the deferred "Memgraph" model,
   built as a pure in-memory graph derived from the snapshot. The agent layer
   reasons over it: "this hab depends on this O2 line depends on this electrolysis
   unit depends on this reactor." It never touches the tick (doc §0).

   The payoff query is diagnoseShortfall(): a recursive root-cause trace down the
   cascade — oxygen is failing because electrolysis is unfed because water is
   empty because the extractor lost power to the storm.
   ============================================================================ */
import type { BuildingState, Resource, Snapshot } from "@shared/types";
import { DEFS } from "@/engine";

export type NodeKind = "building" | "pool" | "crew" | "hub" | "environment";
export type EdgeKind = "feeds" | "draws" | "sealed-by";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** resource for pool nodes; defId for building nodes */
  ref?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** per-second rate where meaningful */
  rate?: number;
}

export interface WorldGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

/** prototype status(): is a building actually producing right now? */
export function buildingAlive(b: BuildingState): boolean {
  const def = DEFS[b.defId];
  return b.online && (!def.requiresPressure || b.connected) && b.staffed && b.fed;
}

/** Build the graph for the current snapshot. Cheap; rebuilt on demand. */
export function buildGraph(s: Snapshot): WorldGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const add = (n: GraphNode) => nodes.set(n.id, n);

  // pools
  for (const r of ["power", "water", "oxygen", "food"] as Resource[]) {
    add({ id: `pool:${r}`, kind: "pool", label: r, ref: r });
  }
  // environment + crew
  add({ id: "env:sun", kind: "environment", label: "the sun" });
  add({ id: "crew", kind: "crew", label: "the colonists" });

  // buildings + their production/consumption edges
  for (const b of s.buildings) {
    const def = DEFS[b.defId];
    if (!def) continue;
    const id = `b:${b.uid}`;
    add({
      id,
      kind: def.isHub ? "hub" : "building",
      label: def.name,
      ref: b.defId,
    });
    for (const k in def.produces) {
      edges.push({ from: id, to: `pool:${k}`, kind: "feeds", rate: def.produces[k as Resource] });
    }
    for (const k in def.consumes) {
      edges.push({ from: id, to: `pool:${k}`, kind: "draws", rate: def.consumes[k as Resource] });
    }
    if (def.solar) edges.push({ from: "env:sun", to: id, kind: "feeds", rate: def.solar });
    if (def.requiresPressure) {
      const hub = s.buildings.find((x) => DEFS[x.defId]?.isHub);
      if (hub) edges.push({ from: id, to: `b:${hub.uid}`, kind: "sealed-by" });
    }
  }

  // crew draws on life support
  for (const r of ["oxygen", "water", "food"] as Resource[]) {
    edges.push({ from: "crew", to: `pool:${r}`, kind: "draws" });
  }

  return { nodes, edges };
}

/** buildings producing into a pool */
export function producersOf(s: Snapshot, res: Resource): BuildingState[] {
  return s.buildings.filter((b) => (DEFS[b.defId]?.produces[res] ?? 0) > 0);
}

/** buildings drawing from a pool */
export function consumersOf(s: Snapshot, res: Resource): BuildingState[] {
  return s.buildings.filter((b) => (DEFS[b.defId]?.consumes[res] ?? 0) > 0);
}

export type FailReason =
  | "unsealed" // requiresPressure but not connected to the hub
  | "unstaffed" // not enough labor
  | "unpowered" // shed in a brownout
  | "starved" // a non-power input is empty
  | "none";

export interface FailingProducer {
  defId: string;
  name: string;
  reason: FailReason;
  /** the empty input resource when reason === "starved" */
  starvedOf?: Resource;
}

export interface Diagnosis {
  resource: Resource;
  draining: boolean;
  /** producers exist and run, but demand still outpaces supply */
  demandExceedsSupply: boolean;
  /** no producer exists at all */
  noProducer: boolean;
  failing: FailingProducer[];
  /** recursive upstream cause (e.g. oxygen → water → power → the dark) */
  upstream?: Diagnosis;
  /** environmental root for power: night / storm */
  environmental?: "night" | "storm";
}

function reasonFor(b: BuildingState, s: Snapshot): { reason: FailReason; starvedOf?: Resource } {
  const def = DEFS[b.defId];
  if (def.requiresPressure && !b.connected) return { reason: "unsealed" };
  if (def.staffing > 0 && !b.staffed) return { reason: "unstaffed" };
  if (!b.fed) {
    for (const k in def.consumes) {
      if (k === "power") continue;
      const r = k as Resource;
      if (s.pools[r].amount <= 0.5) return { reason: "starved", starvedOf: r };
    }
    return { reason: "starved" };
  }
  if (!b.online) return { reason: "unpowered" };
  return { reason: "none" };
}

/** Recursive root-cause trace down the cascade (power → water → oxygen → food). */
export function diagnoseShortfall(
  s: Snapshot,
  res: Resource,
  depth = 0,
  seen: Set<Resource> = new Set(),
): Diagnosis {
  const draining = s.flow[res] < -0.05;
  const producers = producersOf(s, res);
  const aliveProducers = producers.filter(buildingAlive);
  const failing: FailingProducer[] = producers
    .filter((b) => !buildingAlive(b))
    .map((b) => {
      const { reason, starvedOf } = reasonFor(b, s);
      return { defId: b.defId, name: DEFS[b.defId].name, reason, starvedOf };
    });

  const diag: Diagnosis = {
    resource: res,
    draining,
    demandExceedsSupply: aliveProducers.length > 0 && draining,
    noProducer: producers.length === 0,
    failing,
  };

  // power's root cause is environmental (the dark / the storm) when solar is gutted
  if (res === "power" && s.solarMul < 0.3 && s.pools.power.amount < s.pools.power.capacity * 0.2) {
    diag.environmental = s.weather === "dust" ? "storm" : "night";
  }

  // trace one upstream cause: a starved producer points at its empty input
  if (depth < 4 && !seen.has(res)) {
    const next = new Set(seen).add(res);
    const starved = failing.find((f) => f.reason === "starved" && f.starvedOf);
    const unpowered = failing.find((f) => f.reason === "unpowered");
    if (starved?.starvedOf && !next.has(starved.starvedOf)) {
      diag.upstream = diagnoseShortfall(s, starved.starvedOf, depth + 1, next);
    } else if (unpowered && res !== "power" && !next.has("power")) {
      diag.upstream = diagnoseShortfall(s, "power", depth + 1, next);
    }
  }

  return diag;
}
