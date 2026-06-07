/* ============================================================================
   Seeded RNG (mulberry32). Replaces Math.random everywhere in the engine so the
   sim is deterministic and replayable, and the seed/state serialize into the
   save (doc §2.4, §5). One 32-bit integer of state — trivially serializable.
   ============================================================================ */

export class RNG {
  private s: number;

  constructor(seed: number) {
    // keep it a uint32
    this.s = seed >>> 0;
  }

  /** next float in [0, 1) */
  next(): number {
    let a = (this.s += 0x6d2b79f5);
    a = Math.imul(a ^ (a >>> 15), 1 | a);
    a ^= a + Math.imul(a ^ (a >>> 7), 61 | a);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  }

  /** float in [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  getState(): number {
    return this.s >>> 0;
  }

  setState(state: number): void {
    this.s = state >>> 0;
  }
}
