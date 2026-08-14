/* ============================================================================
   Terminal-cause contract — the engine, save boundary, event stream, and final
   snapshot must agree on why a run ended. The UI deliberately does no guessing.
   ============================================================================ */
import { describe, expect, it } from "vitest";
import type { ColonyEvent } from "@shared/types";
import { Colony } from "./colony";
import type { ColonyState } from "./state";
import { applyStrikeInjuries } from "./injury";

const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

function defeatEvent(c: Colony): ColonyEvent {
  const event = c.drainEvents().find((e) => e.type === "defeat");
  expect(event).toBeDefined();
  return event!;
}

describe("terminal defeat causes", () => {
  it.each(["oxygen", "water", "food"] as const)(
    "records %s exhaustion in both the event and frozen snapshot",
    (resource) => {
      const c = new Colony(91);
      const s = stateOf(c);
      c.setDirector(true);
      s.buildings = [];
      s.grid.fill(0);
      s.population = 1;
      s.colonists = s.colonists.slice(0, 1);
      s.pools[resource].amount = 0;
      s.timers[resource] = 0.01;

      c.tick(0.2);

      const cause = { type: "resource", resource } as const;
      expect(c.snapshot()).toMatchObject({ outcome: "defeat", defeatCause: cause });
      expect(defeatEvent(c).cause).toEqual(cause);
    },
  );

  it("records the actual impact kind when a strike removes the final crew member", () => {
    const c = new Colony(92);
    const s = stateOf(c);
    c.setDirector(true);
    s.population = 1;
    s.colonists = s.colonists.slice(0, 1);
    const colonist = s.colonists[0];
    colonist.x = 5;
    colonist.y = 5;
    colonist.injury = 10;
    applyStrikeInjuries(s, 5, 5, { id: 900, kind: "quake" }, () => {});

    c.tick(0.2);

    const cause = { type: "strike", hazard: "quake" } as const;
    expect(c.snapshot()).toMatchObject({ outcome: "defeat", defeatCause: cause });
    expect(defeatEvent(c).cause).toEqual(cause);
  });

  it("uses an explicit unknown cause when no casualty supplied one", () => {
    const c = new Colony(93);
    const s = stateOf(c);
    c.setDirector(true);
    s.population = 0;
    s.colonists = [];
    s.lastLossCause = null;

    c.tick(0.2);

    expect(c.snapshot().defeatCause).toEqual({ type: "unknown" });
    expect(defeatEvent(c).cause).toEqual({ type: "unknown" });
  });

  it("records a missed launch window independently of recent losses", () => {
    const c = new Colony(94);
    const s = stateOf(c);
    c.setDirector(true);
    s.sol = s.deadlineSol;
    s.lastLossCause = { type: "strike", hazard: "meteor" };

    c.tick(0.2);

    expect(c.snapshot()).toMatchObject({
      outcome: "defeat",
      outcomeReason: "window",
      defeatCause: { type: "window" },
    });
    expect(defeatEvent(c).cause).toEqual({ type: "window" });
  });
});

describe("terminal-cause persistence", () => {
  it("round-trips valid causes and does not alias the live state", () => {
    const c = new Colony(95);
    const s = stateOf(c);
    s.lastLossCause = { type: "strike", hazard: "quake" };
    s.defeatCause = { type: "strike", hazard: "quake" };

    const save = c.serialize();
    expect(save.state.lastLossCause).not.toBe(s.lastLossCause);
    expect(save.state.defeatCause).not.toBe(s.defeatCause);
    const loaded = Colony.load(save);
    expect(stateOf(loaded).lastLossCause).toEqual(s.lastLossCause);
    expect(loaded.snapshot().defeatCause).toEqual(s.defeatCause);
  });

  it("rejects impossible causes from an edited or legacy save", () => {
    const save = new Colony(96).serialize();
    (save.state as unknown as { defeatCause: unknown }).defeatCause = {
      type: "strike",
      hazard: "dust",
    };
    (save.state as unknown as { lastLossCause: unknown }).lastLossCause = {
      type: "resource",
      resource: "power",
    };

    const loaded = Colony.load(save);
    expect(loaded.snapshot().defeatCause).toBeNull();
    expect(stateOf(loaded).lastLossCause).toBeNull();
  });
});
