/* ============================================================================
   Tests for the placing strip's seal-preview line: one status line per
   SealPreview kind, singular/plural cell count, and floored materials on the
   unaffordable line (doc: pressure network design §3).
   ============================================================================ */
import { describe, expect, it } from "vitest";
import type { SealPreview } from "@/engine";
import { sealPreviewText } from "./sealPreview";

describe("sealPreviewText", () => {
  it("touching the network needs no corridor", () => {
    expect(sealPreviewText({ kind: "touching" }, 0)).toEqual({
      text: "connects to the network",
      warn: false,
    });
  });

  it("prices an affordable corridor, plural cells", () => {
    const p: SealPreview = {
      kind: "corridor", path: [[2, 0], [3, 0], [4, 0]], cells: 3, cost: 6, total: 30, affordable: true,
    };
    expect(sealPreviewText(p, 500)).toEqual({
      text: "lays 3 corridor cells · 6 mat (30 total)",
      warn: false,
    });
  });

  it("uses the singular for exactly one cell", () => {
    const p: SealPreview = {
      kind: "corridor", path: [[2, 0]], cells: 1, cost: 2, total: 26, affordable: true,
    };
    expect(sealPreviewText(p, 500)).toEqual({
      text: "lays 1 corridor cell · 2 mat (26 total)",
      warn: false,
    });
  });

  it("warns and floors materials on hand when the corridor is unaffordable", () => {
    const p: SealPreview = {
      kind: "corridor", path: [[2, 0], [3, 0]], cells: 2, cost: 4, total: 50, affordable: false,
    };
    expect(sealPreviewText(p, 37.9)).toEqual({
      text: "needs 50 mat, have 37",
      warn: true,
    });
  });

  it("warns when there is no route to the network", () => {
    expect(sealPreviewText({ kind: "no-route" }, 0)).toEqual({
      text: "no route to the network · will be unsealed",
      warn: true,
    });
  });
});
