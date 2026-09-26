/* ============================================================================
   The placing strip's seal-preview line: turns a SealPreview (the corridor the
   engine would lay for a sealed building, or why it can't) into the one status
   line Inspector.vue shows while aiming (doc: pressure network design §3).
   ============================================================================ */
import type { SealPreview } from "@/engine";

export function sealPreviewText(p: SealPreview, materials: number): { text: string; warn: boolean } {
  switch (p.kind) {
    case "touching":
      return { text: "connects to the network", warn: false };
    case "corridor": {
      if (!p.affordable) return { text: `needs ${p.total} mat, have ${Math.floor(materials)}`, warn: true };
      const cell = p.cells === 1 ? "cell" : "cells";
      return { text: `lays ${p.cells} corridor ${cell} · ${p.cost} mat (${p.total} total)`, warn: false };
    }
    case "no-route":
      return { text: "no route to the network · will be unsealed", warn: true };
  }
}
