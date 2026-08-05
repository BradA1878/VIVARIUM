import { describe, expect, it } from "vitest";
import type { ColonyEvent } from "@shared/types";
import { BubbleSystem, directActionReaction } from "./bubbles";

function event(extra: Partial<ColonyEvent> & Pick<ColonyEvent, "type">): ColonyEvent {
  return { t: 10, sol: 1, tod: 0.5, ...extra };
}

describe("direct cargo action bubbles", () => {
  it("formats single-kind pickups and capacity-clamped unloads", () => {
    expect(directActionReaction(event({ type: "cargo_picked", cargo: { ore: 20 } })))
      .toEqual(["+20 ore", "cyan"]);
    expect(directActionReaction(event({
      type: "cargo_unloaded", cargo: { ore: 20 }, banked: { ore: 7 },
    }))).toEqual(["banked 7 ore", "cyan"]);
  });

  it("summarizes mixed rover beds and stays honest when every bank is full", () => {
    expect(directActionReaction(event({
      type: "cargo_unloaded",
      cargo: { ice: 30, ore: 20 },
      banked: { ice: 30, ore: 20 },
    }))).toEqual(["banked 50 cargo", "cyan"]);
    expect(directActionReaction(event({
      type: "cargo_unloaded", cargo: { cache: 12 }, banked: {},
    }))).toEqual(["unloaded 12 cache", "cyan"]);
  });

  it("does not invent feedback for unrelated or empty events", () => {
    expect(directActionReaction(event({ type: "trade_done" }))).toBeNull();
    expect(directActionReaction(event({ type: "cargo_picked", cargo: {} }))).toBeNull();
  });

  it("lets direct confirmations bypass possession and chatter cooldown", () => {
    const bubbles = new BubbleSystem();
    bubbles.setPossessed(7);
    (bubbles as unknown as { lastAt: Map<number, number> }).lastAt.set(7, 900);

    expect(bubbles.available(7, 1_000)).toBe(false);
    expect(bubbles.available(7, 1_000, { directAction: true })).toBe(true);
    bubbles.dispose();
  });
});
