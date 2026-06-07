/* ============================================================================
   Sentinel tests — telemetry features are well-formed, and the autoencoder
   genuinely learns "normal": after training on a tight cluster, a far outlier
   reconstructs worse than an in-distribution sample. (Doc §7.)
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "@/engine";
import { featureVector, FEATURE_DIM, FEATURE_LABELS } from "./features";
import { Autoencoder } from "./autoencoder";

describe("telemetry features", () => {
  it("produces a fixed-length, normalized vector", () => {
    const v = featureVector(new Colony().snapshot());
    expect(v.length).toBe(FEATURE_DIM);
    expect(v.length).toBe(FEATURE_LABELS.length);
    expect(v.every((x) => x >= 0 && x <= 1)).toBe(true);
  });

  it("a zero net flow maps to the 0.5 midpoint", () => {
    const s = new Colony().snapshot();
    s.flow = { power: 0, water: 0, oxygen: 0, food: 0 };
    const v = featureVector(s);
    // the flow features occupy indices 4..7
    expect(v[4]).toBeCloseTo(0.5, 5);
  });
});

describe("the autoencoder learns normal", () => {
  it("scores a far outlier worse than an in-distribution sample", async () => {
    const ae = new Autoencoder();
    const ok = await ae.ensure();
    expect(ok).toBe(true);

    // a tight cluster of "normal" telemetry around 0.5
    const normal: number[][] = [];
    let seed = 1;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 80; i++) {
      normal.push(Array.from({ length: FEATURE_DIM }, () => 0.5 + (rnd() - 0.5) * 0.06));
    }
    await ae.train(normal, 60);

    const inDist = Array.from({ length: FEATURE_DIM }, () => 0.5);
    const outlier = Array.from({ length: FEATURE_DIM }, () => 0.0); // far off the manifold

    const errIn = ae.scoreFeatures(inDist).reduce((a, b) => a + b, 0);
    const errOut = ae.scoreFeatures(outlier).reduce((a, b) => a + b, 0);

    expect(errOut).toBeGreaterThan(errIn);
    ae.dispose();
  }, 30000);
});
