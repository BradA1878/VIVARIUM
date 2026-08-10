import { describe, expect, it } from "vitest";
import { TECH_IDS } from "@/engine";
import { alienTechFromEvent, alienTechView } from "./alienTech";

const event = (overrides: Partial<Parameters<typeof alienTechFromEvent>[0]> = {}) => ({
  type: "trade_done" as const,
  t: 1,
  sol: 1,
  tod: 0.5,
  ...overrides,
});

describe("alien-tech acquisition presentation", () => {
  it("distinguishes a permanent upgrade from an ordinary resource trade", () => {
    expect(alienTechFromEvent(event({ detail: "water" }))).toBeNull();
    expect(alienTechFromEvent(event({ tech: "capacitor", detail: "Capacitor Lattice" })))
      .toMatchObject({
        id: "capacitor",
        name: "Capacitor Lattice",
        effect: "+140 kW maximum power capacity.",
      });
  });

  it("gives every obtainable tech a named, exact active effect", () => {
    for (const id of TECH_IDS) {
      const view = alienTechView(id);
      expect(view.name.trim()).not.toBe("");
      expect(view.lore.trim()).not.toBe("");
      expect(view.effect.trim()).not.toBe("");
    }
  });

  it("keeps stale save ids legible", () => {
    expect(alienTechView("unknown-relic")).toEqual(expect.objectContaining({
      id: "unknown-relic",
      glyph: "◇",
      effect: expect.stringContaining("No modeled effect"),
    }));
    expect(alienTechView("constructor")).toEqual(expect.objectContaining({
      name: "Unrecognized Relic",
      effect: expect.stringContaining("No modeled effect"),
    }));
  });
});
