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
      // the lit sky is brighter than the dark void the fog/background paints at the
      // top of the frame, so upward-facing metal does not reflect black
      expect(lum(env.zenith.clear)).toBeGreaterThan(lum(look.sky.top.clear));
    });
  }
});
