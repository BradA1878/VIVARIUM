/* ============================================================================
   The Sentinel — the Watcher's eyes (doc §7). It samples colony telemetry, trains
   an autoencoder on a rolling window to learn "normal", and flags samples that
   reconstruct poorly — drift the rule-based alerts (fixed thresholds) miss: a
   slow leak, an odd flow pattern, the shape of trouble before it trips a limit.
   On an anomaly it calls back with the most-deviant feature; the store turns that
   into a synthetic "anomaly" event for the Watcher. Pure agent layer — reads
   snapshots, never the tick (doc §0). No-op if tf.js fails to load.
   ============================================================================ */
import type { Snapshot } from "@shared/types";
import { Autoencoder } from "./autoencoder";
import { featureVector, FEATURE_LABELS } from "./features";

export interface Anomaly {
  /** human-readable feature that deviated most, e.g. "oxygen flow" */
  feature: string;
  /** how many standard deviations above learned-normal */
  sigma: number;
  snapshot: Snapshot;
}

const SAMPLE_DT = 0.8; // sim-seconds between telemetry samples
const WINDOW = 160; // rolling training window size
const MIN_TRAIN = 50; // samples before the first training
const TRAIN_EVERY = 40; // retrain cadence (samples)
const WARMUP_SCORES = 30; // scored samples before we trust the error stats
const K_SIGMA = 3.5; // anomaly threshold in std-devs
const ERR_FLOOR = 0.015; // ignore tiny-magnitude "anomalies"
const ANOMALY_COOLDOWN = 45; // sim-seconds between flags

export class Sentinel {
  private ae = new Autoencoder();
  private window: number[][] = [];
  private sinceTrain = 0;
  private training = false;
  private lastSample = -999;
  private lastAnomaly = -999;
  private scored = 0;
  // EWMA of total reconstruction error (mean + variance)
  private errMean = 0;
  private errVar = 0;
  private onAnomalyCb: ((a: Anomaly) => void) | null = null;

  onAnomaly(cb: (a: Anomaly) => void): void {
    this.onAnomalyCb = cb;
  }

  /** feed a snapshot at sim-time `now`. Throttled internally. */
  push(s: Snapshot, now: number): void {
    if (now - this.lastSample < SAMPLE_DT) return;
    this.lastSample = now;

    const vec = featureVector(s);
    this.window.push(vec);
    if (this.window.length > WINDOW) this.window.shift();

    // (re)train on the rolling window, off the critical path
    this.sinceTrain++;
    const due = this.window.length === MIN_TRAIN || (this.ae.ready && this.sinceTrain >= TRAIN_EVERY);
    if (due && !this.training && this.window.length >= MIN_TRAIN) {
      this.sinceTrain = 0;
      this.training = true;
      void this.ae.ensure().then((ok) => (ok ? this.ae.train(this.window.slice()) : undefined))
        .finally(() => { this.training = false; });
    }

    if (!this.ae.ready) return;

    // score this sample and update the running error statistics
    const feats = this.ae.scoreFeatures(vec);
    const total = feats.reduce((a, b) => a + b, 0);
    this.scored++;
    const a = 0.06; // EWMA weight
    const delta = total - this.errMean;
    this.errMean += a * delta;
    this.errVar = (1 - a) * (this.errVar + a * delta * delta);

    if (this.scored < WARMUP_SCORES) return;
    const std = Math.sqrt(this.errVar) || 1e-6;
    const sigma = (total - this.errMean) / std;
    if (total > ERR_FLOOR && sigma > K_SIGMA && now - this.lastAnomaly > ANOMALY_COOLDOWN) {
      this.lastAnomaly = now;
      // which feature drove it?
      let top = 0;
      for (let i = 1; i < feats.length; i++) if (feats[i] > feats[top]) top = i;
      this.onAnomalyCb?.({ feature: FEATURE_LABELS[top], sigma, snapshot: s });
    }
  }

  reset(): void {
    this.window = [];
    this.sinceTrain = 0;
    this.scored = 0;
    this.errMean = 0;
    this.errVar = 0;
    this.lastSample = -999;
    this.lastAnomaly = -999;
  }

  dispose(): void {
    this.ae.dispose();
  }
}
