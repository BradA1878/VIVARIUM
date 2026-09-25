import { describe, expect, it } from "vitest";
import { WORLD_LOOKS, type RGB } from "./worldlook";

const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const valid = (c: RGB) => c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);

describe("world environment palettes", () => {
  for (const [world, look] of Object.entries(WORLD_LOOKS)) {
    it(`${world} defines a complete, ordered sky environment`, () => {
      const env = look.sky.env;
      for (const band of [env.zenith, env.horizon]) {
        expect(valid(band.night) && valid(band.dust) && valid(band.clear)).toBe(true);
        // night is darker than both daylight states
        expect(lum(band.night)).toBeLessThan(lum(band.clear));
        expect(lum(band.night)).toBeLessThan(lum(band.dust));
      }
      expect(valid(env.lowSunGlow)).toBe(true);
      expect(env.bounce).toBeGreaterThan(0);
      expect(env.bounce).toBeLessThanOrEqual(3);
      // the lit zenith is a real sky, not a dark void, so upward-facing metal
      // does not reflect black
      expect(lum(env.zenith.clear)).toBeGreaterThan(0.35 * lum(env.horizon.clear));
      // the grade stays subtle
      const g = look.grade;
      expect(valid(g.lift) && valid(g.gain)).toBe(true);
      expect(Math.max(...g.lift)).toBeLessThanOrEqual(24);
      expect(Math.min(...g.gain)).toBeGreaterThanOrEqual(220);
      expect(g.saturation).toBeGreaterThanOrEqual(0.9);
      expect(g.saturation).toBeLessThanOrEqual(1.15);
      expect(g.vignette).toBeGreaterThanOrEqual(0);
      expect(g.vignette).toBeLessThanOrEqual(0.35);
    });
  }
});
