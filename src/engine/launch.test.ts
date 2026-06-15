/* ============================================================================
   The PTP launch (slice 4) — the Planetary Transport Pod is a gated endgame
   building; launching it is a DELIBERATE player act (not a tick threshold) that
   ends the run as an "expansion". The engine only records the outcome + emits
   the event; the main thread orchestrates founding the next world (the wall).
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "./index";
import { GATES } from "./unlocks";
import { emptyBuilding, type ColonyState } from "./state";

const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

function gateState(over: Partial<ColonyState> = {}): ColonyState {
  return {
    sol: 1, population: 4,
    materials: { amount: 0, capacity: 400 },
    buildings: [], hazards: [], unlocked: [],
    ...over,
  } as unknown as ColonyState;
}
const reactorBuilt = () => [{ defId: "reactor" }] as ColonyState["buildings"];

describe("PTP gate", () => {
  it("needs a reactor built AND population/materials past the reactor tier", () => {
    expect(GATES.ptp(gateState())).toBe(false);
    // a reactor alone isn't enough — it's the prize past a thriving colony
    expect(GATES.ptp(gateState({ buildings: reactorBuilt() }))).toBe(false);
    // pop/materials without a reactor isn't enough either
    expect(GATES.ptp(gateState({ population: 12, materials: { amount: 300, capacity: 400 } }))).toBe(false);
    expect(GATES.ptp(gateState({
      buildings: reactorBuilt(), population: 12, materials: { amount: 300, capacity: 400 },
    }))).toBe(true);
  });
});

describe("launchPtp → expansion", () => {
  it("with a functional pod built: sets the expansion outcome, pauses, emits once", () => {
    const c = new Colony(7);
    stateOf(c).buildings.push(emptyBuilding(999, "ptp", 0, 0)); // integrity 1 → functional
    c.launchPtp();
    expect(c.snapshot().outcome).toBe("expansion");
    expect(c.snapshot().paused).toBe(true);
    expect(c.drainEvents().filter((e) => e.type === "expansion")).toHaveLength(1);
  });

  it("with no pod built: a no-op (the outcome stays live)", () => {
    const c = new Colony(7);
    c.launchPtp();
    expect(c.snapshot().outcome).toBeNull();
    expect(c.drainEvents().filter((e) => e.type === "expansion")).toHaveLength(0);
  });

  it("launches when ANY functional pod exists, even if a damaged pod was built first", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    const broken = emptyBuilding(998, "ptp", 0, 0); broken.integrity = 0.2; // dead pod, built first
    const good = emptyBuilding(999, "ptp", 4, 4); // intact pod, built later
    s.buildings.push(broken, good);
    c.launchPtp();
    expect(c.snapshot().outcome).toBe("expansion");
  });

  it("a single damaged pod is not enough to launch", () => {
    const c = new Colony(7);
    const dead = emptyBuilding(999, "ptp", 0, 0); dead.integrity = 0.2;
    stateOf(c).buildings.push(dead);
    c.launchPtp();
    expect(c.snapshot().outcome).toBeNull();
  });

  it("does nothing once the run has already ended", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.buildings.push(emptyBuilding(999, "ptp", 0, 0));
    s.outcome = "victory";
    c.launchPtp();
    expect(c.snapshot().outcome).toBe("victory"); // not overwritten
  });
});
