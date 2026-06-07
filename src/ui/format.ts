/* ============================================================================
   HUD formatting helpers — shared by the readout components. Mono, tabular,
   exact (doc §4.2: the instruments talk in numbers).
   ============================================================================ */

export function fmt(n: number | null | undefined, d = 0): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toFixed(d);
}

/** time of day 0..1 → HH:MM */
export function clockOf(tod: number): string {
  const h = Math.floor(tod * 24);
  const m = Math.floor((tod * 24 - h) * 60);
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/** seconds-to-empty for a draining pool, formatted; null if not draining/too far */
export function eta(amount: number, net: number): string | null {
  if (net >= -0.01) return null;
  const s = amount / -net;
  if (!isFinite(s) || s > 600) return null;
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return m > 0 ? `${m}m${String(ss).padStart(2, "0")}` : `${ss}s`;
}
