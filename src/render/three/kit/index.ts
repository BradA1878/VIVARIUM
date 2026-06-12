/* ============================================================================
   Kit registry — maps a building def to its procedural builder (doc §2.1: the
   building is data; the renderer just looks up how to draw it). Swap any entry
   for a GLTFLoader-backed builder later to drop in real .glb assets.
   ============================================================================ */
import type { BuildingDef } from "@shared/types";
import type { KitBuilder, KitContext, KitMesh } from "./contract";
import type { MaterialLib } from "../materials";
import { CELL } from "../coords";
import { buildDome } from "./dome";
import { buildTank } from "./tank";
import { buildSolar } from "./solar";
import { buildCorridor } from "./corridor";
import { buildDrum } from "./drum";
import { buildWind } from "./wind";
import { buildReactor } from "./reactor";
import { buildFacility } from "./facility";

function builderFor(def: BuildingDef): KitBuilder {
  if (def.solar) return buildSolar;
  if (def.conduit) return buildCorridor;
  if (def.id === "battery") return buildDrum;
  if (def.id === "windturbine") return buildWind;
  if (def.id === "reactor") return buildReactor;
  if (def.id === "printer" || def.id === "roverbay" || def.id === "roboticsbay") {
    return buildFacility;
  }
  if (def.id === "extractor" || def.id === "electrolysis" || def.id === "cistern" || def.id === "o2tank" || def.id === "geothermal") {
    return buildTank;
  }
  return buildDome; // hub, hab, greenhouse
}

export function buildKitMesh(def: BuildingDef, uid: number, materials: MaterialLib): KitMesh {
  const ctx: KitContext = {
    materials,
    def,
    cell: CELL,
    // stable per-building seed for greeble variation
    seed: (uid * 2654435761) >>> 0,
  };
  return builderFor(def)(ctx);
}

export type { KitMesh, KitEnv } from "./contract";
