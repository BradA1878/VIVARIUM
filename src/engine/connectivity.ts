/* ============================================================================
   Connectivity is a boolean gate (doc §2.3). A requiresPressure building is
   "online" only if the seal reaches it: every hub roots a flood that passes
   through hubs, corridors, and sealed buildings (seal.ts), so docked modules
   share the seal and each hub runs its own network. Surface buildings neither
   need nor pass it and are never marked connected. We are explicitly NOT
   simulating flow through pipes — this is SimCity's road check, reskinned.
   ============================================================================ */
import { sealNetwork } from "./seal";
import type { ColonyState } from "./state";

export function recomputeConnectivity(s: ColonyState): void {
  const net = sealNetwork(s.N, s.buildings);
  for (const b of s.buildings) b.connected = net.connected.has(b.uid);
}
