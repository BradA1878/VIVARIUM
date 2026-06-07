/* ============================================================================
   Resource display metadata for the readout rail (doc §4.3). Ported from the
   prototype's RES table. Order matches the cascade: power → oxygen → water →
   food.
   ============================================================================ */
import type { Resource } from "@shared/types";

export interface ResMeta {
  k: Resource;
  label: string;
  glyph: string;
  col: string;
  unit: string;
}

export const RES: ResMeta[] = [
  { k: "power", label: "POWER", glyph: "⚡", col: "#7fd4e8", unit: "kW" },
  { k: "oxygen", label: "OXYGEN", glyph: "O₂", col: "#9fe0e0", unit: "kPa" },
  { k: "water", label: "WATER", glyph: "H₂O", col: "#6aa8d0", unit: "m³" },
  { k: "food", label: "FOOD", glyph: "≡", col: "#9bb58c", unit: "kg" },
];
