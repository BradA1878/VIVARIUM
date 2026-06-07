/* ============================================================================
   The autoencoder (doc §7: a real job for TensorFlow.js). A tiny dense
   bottleneck network learns to reconstruct "normal" colony telemetry; the
   per-feature reconstruction error is the anomaly signal. tf.js is lazy-loaded
   so its weight stays out of the main bundle — this is agent-layer only and
   never touches the engine tick (doc §0). Degrades to a no-op if tf fails to load.
   ============================================================================ */
import type * as tfNS from "@tensorflow/tfjs";
import { FEATURE_DIM } from "./features";

type TF = typeof tfNS;

export class Autoencoder {
  private tf: TF | null = null;
  private model: tfNS.LayersModel | null = null;
  private loading: Promise<void> | null = null;

  /** lazy-load tf + build the model (8 → 4 → 2 → 4 → 8 dense bottleneck) */
  async ensure(): Promise<boolean> {
    if (this.model) return true;
    if (!this.loading) {
      this.loading = (async () => {
        try {
          this.tf = await import("@tensorflow/tfjs");
          const tf = this.tf;
          const m = tf.sequential();
          m.add(tf.layers.dense({ inputShape: [FEATURE_DIM], units: 6, activation: "relu" }));
          m.add(tf.layers.dense({ units: 3, activation: "relu" })); // bottleneck
          m.add(tf.layers.dense({ units: 6, activation: "relu" }));
          m.add(tf.layers.dense({ units: FEATURE_DIM, activation: "sigmoid" }));
          m.compile({ optimizer: tf.train.adam(0.01), loss: "meanSquaredError" });
          this.model = m;
        } catch {
          this.tf = null;
          this.model = null;
        }
      })();
    }
    await this.loading;
    return this.model != null;
  }

  get ready(): boolean {
    return this.model != null && this.tf != null;
  }

  /** train a few epochs on the recent window to (re)learn what normal looks like */
  async train(window: number[][], epochs = 12): Promise<void> {
    if (!this.tf || !this.model || window.length < 8) return;
    const tf = this.tf;
    const xs = tf.tensor2d(window);
    try {
      await this.model.fit(xs, xs, { epochs, batchSize: 16, shuffle: true, verbose: 0 });
    } catch {
      /* training hiccup — keep the previous weights */
    } finally {
      xs.dispose();
    }
  }

  /** per-feature squared reconstruction error for one sample (sync, cheap) */
  scoreFeatures(vec: number[]): number[] {
    if (!this.tf || !this.model) return new Array(vec.length).fill(0);
    const tf = this.tf;
    return tf.tidy(() => {
      const x = tf.tensor2d([vec]);
      const out = this.model!.predict(x) as tfNS.Tensor;
      const errs = tf.squaredDifference(out, x).dataSync();
      return Array.from(errs);
    });
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
  }
}
