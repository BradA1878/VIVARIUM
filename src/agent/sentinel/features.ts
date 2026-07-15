/* ============================================================================
   Telemetry features for the Sentinel (Phase 13). Each snapshot reduces to a
   fixed-length, roughly-normalized vector — the colony's vital signs. The
   autoencoder learns the manifold of "normal" colony states from these; novel
   states reconstruct poorly and read as anomalies. Pure (no tf here).
   ============================================================================ */
import type { Resource, Snapshot } from "@shared/types";

const POOLS: Resource[] = ["power", "water", "oxygen", "food"];

/** human-readable label per feature index, for the Watcher's report.
 *  New features append at the END so earlier indices stay stable. */
export const FEATURE_LABELS: string[] = [
  ...POOLS.map((r) => `${r} reserve`),
  ...POOLS.map((r) => `${r} flow`),
  "the light",
  "the crew",
  "the fabricators",
];

/** snapshot → feature vector (length = FEATURE_LABELS.length) */
export function featureVector(s: Snapshot): number[] {
  const fill = POOLS.map((r) => clamp01(s.pools[r].amount / Math.max(1, s.pools[r].capacity)));
  // flows squashed to 0..1 around zero (tanh-like) so sign + magnitude survive
  const flow = POOLS.map((r) => 0.5 + 0.5 * Math.tanh(s.flow[r] / 10));
  const sun = clamp01(s.solarMul);
  const crew = clamp01(s.population / 24);
  // the self-replicating lineage: saturates at 16 (≈⅓ of FAB_MAX_LINEAGE = 50,
  // the crew-normalizer idiom) so the anomaly signal has dynamic range across
  // the 1 → 16 growth phase — exactly when a runaway is still stoppable
  const fabs = clamp01(
    s.buildings.reduce((n, b) => n + (b.defId === "fabricator" ? 1 : 0), 0) / 16,
  );
  return [...fill, ...flow, sun, crew, fabs];
}

export const FEATURE_DIM = FEATURE_LABELS.length;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
