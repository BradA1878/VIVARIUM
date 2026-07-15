/* ============================================================================
   Facility — one builder for the industrial fabrication family, switched by a
   specFor(id) the way tank.ts keys its vessels:

     printer     — a boxy fabricator with a row of status-bar lights across the
                   front face (they pulse in sequence while it runs)
     roverbay    — a garage: a wide low box with a recessed emissive door slab
                   on the def's door side and a shallow ramp out of it
     roboticsbay — a gantry: four corner posts under a top frame, with a tool
                   block hanging from the crossbeam over the work floor
     fabricator  — the self-replicator: twin extruder towers over an emissive
                   core, with a front gauge that FILLS with replication
                   progress (status.fill) instead of chasing

   Local door convention: def.door = 2 (S) is local +Z before rotation; the
   renderer turns the whole group by the building's rot, so the garage door and
   ramp aim wherever the player pointed them. Built around the local origin,
   base on y = 0, growing +Y.
   ============================================================================ */
import * as THREE from "three";
import type { KitBuilder, KitContext, KitMesh, BuildingStatus, KitEnv } from "./contract";
import { disposeObject } from "./contract";
import { statusGlow, applyGlow } from "../materials";

interface FacilitySpec {
  kind: "printer" | "roverbay" | "roboticsbay" | "fabricator";
  /** body metal hex */
  metal: string;
}

function specFor(id: string): FacilitySpec {
  switch (id) {
    case "printer":
      return { kind: "printer", metal: "#8a7f94" }; // violet-grey fabricator
    case "roverbay":
      return { kind: "roverbay", metal: "#76828e" }; // garage blue-grey
    case "fabricator":
      return { kind: "fabricator", metal: "#7d8a6e" }; // moss — the lineage's livery
    case "roboticsbay":
    default:
      return { kind: "roboticsbay", metal: "#8c8470" }; // workshop tan
  }
}

export const buildFacility: KitBuilder = (ctx: KitContext): KitMesh => {
  const { materials, def, cell } = ctx;
  const spec = specFor(def.id);

  const group = new THREE.Group();
  group.name = `facility:${def.id}`;

  const w = def.foot[0] * cell;
  const d = def.foot[1] * cell;
  const metalMat = materials.metal(spec.metal);
  const trimMat = materials.metal("#5a626c", { rough: 0.5, metal: 0.8 });

  // every variant shares one status-glow material; the per-frame writes below
  // drive it (the printer's bar lights ride a second material)
  const lightMat = materials.glow();
  const barMats: THREE.MeshStandardMaterial[] = [];

  const box = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  if (spec.kind === "printer") {
    // --- boxy fabricator: a tall body, a hopper on top, front status bars -----
    const bodyW = w * 0.78, bodyH = cell * 0.85, bodyD = d * 0.7;
    box(new THREE.BoxGeometry(bodyW, bodyH, bodyD), metalMat, 0, bodyH / 2, 0);
    box(new THREE.BoxGeometry(bodyW * 0.5, cell * 0.22, bodyD * 0.5), trimMat, 0, bodyH + cell * 0.11, -bodyD * 0.1); // regolith hopper
    box(new THREE.BoxGeometry(bodyW * 1.06, cell * 0.1, bodyD * 1.06), trimMat, 0, cell * 0.05, 0); // skid base
    // the front (+Z) status bar: 4 segment lights that chase while it prints
    const segGeo = new THREE.BoxGeometry(bodyW * 0.14, cell * 0.05, cell * 0.02);
    for (let i = 0; i < 4; i++) {
      const segMat = materials.glow();
      barMats.push(segMat);
      const seg = new THREE.Mesh(segGeo, segMat);
      seg.position.set((i - 1.5) * bodyW * 0.2, bodyH * 0.55, bodyD / 2 + 0.012);
      group.add(seg);
    }
    // out-feed tray under the bars — where the materials trickle out
    box(new THREE.BoxGeometry(bodyW * 0.6, cell * 0.04, cell * 0.16), trimMat, 0, bodyH * 0.3, bodyD / 2 + cell * 0.07, false);
  } else if (spec.kind === "roverbay") {
    // --- garage: a wide low box, recessed lit door slab on +Z, a low ramp -----
    const bodyW = w * 0.9, bodyH = cell * 0.6, bodyD = d * 0.72;
    box(new THREE.BoxGeometry(bodyW, bodyH, bodyD), metalMat, 0, bodyH / 2, -d * 0.08);
    box(new THREE.BoxGeometry(bodyW * 1.04, cell * 0.07, bodyD * 0.3), trimMat, 0, bodyH + cell * 0.035, -d * 0.08); // roof spine
    // recessed emissive door slab on the door side (local +Z; rot turns it)
    const doorW = bodyW * 0.5, doorH = bodyH * 0.72;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, cell * 0.04), lightMat);
    slab.position.set(0, doorH / 2, -d * 0.08 + bodyD / 2 - 0.01); // sunk into the face
    group.add(slab);
    box(new THREE.BoxGeometry(doorW * 1.16, cell * 0.06, cell * 0.06), trimMat, 0, doorH + cell * 0.04, -d * 0.08 + bodyD / 2, false);
    // a low drive-out ramp from the slab toward the door cell (kept inside the
    // footprint edge so it never noses into a neighbour)
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(doorW * 0.92, cell * 0.05, d * 0.22), trimMat);
    ramp.position.set(0, cell * 0.02, -d * 0.08 + bodyD / 2 + d * 0.1);
    ramp.rotation.x = 0.1; // tips down toward the apron
    ramp.receiveShadow = true;
    group.add(ramp);
  } else if (spec.kind === "fabricator") {
    // --- self-replicator: twin extruder towers over an emissive core, front
    // gauge segments that FILL with replication progress (see setStatus) ------
    const bodyW = w * 0.72, bodyH = cell * 0.42, bodyD = d * 0.72;
    box(new THREE.BoxGeometry(bodyW, bodyH, bodyD), metalMat, 0, bodyH / 2, 0); // plinth
    const towerGeo = new THREE.BoxGeometry(cell * 0.14, cell * 0.62, cell * 0.14);
    box(towerGeo, trimMat, -bodyW * 0.32, bodyH + cell * 0.31, -bodyD * 0.18);
    box(towerGeo, trimMat, bodyW * 0.32, bodyH + cell * 0.31, -bodyD * 0.18);
    box(new THREE.BoxGeometry(bodyW * 0.78, cell * 0.07, cell * 0.14), trimMat, 0, bodyH + cell * 0.58, -bodyD * 0.18); // gantry beam
    // the core — where the copy takes shape; shares the beacon glow material
    const core = new THREE.Mesh(new THREE.BoxGeometry(cell * 0.26, cell * 0.26, cell * 0.26), lightMat);
    core.position.set(0, bodyH + cell * 0.24, -bodyD * 0.18);
    core.rotation.y = Math.PI / 4;
    core.castShadow = true;
    group.add(core);
    // the front (+Z) gauge: 4 segments that light up as the countdown runs down
    const segGeo = new THREE.BoxGeometry(bodyW * 0.16, cell * 0.05, cell * 0.02);
    for (let i = 0; i < 4; i++) {
      const segMat = materials.glow();
      barMats.push(segMat);
      const seg = new THREE.Mesh(segGeo, segMat);
      seg.position.set((i - 1.5) * bodyW * 0.22, bodyH * 0.6, bodyD / 2 + 0.012);
      group.add(seg);
    }
  } else {
    // --- robotics gantry: 4 corner posts + a top frame + a hanging tool block -
    const spanW = w * 0.74, spanD = d * 0.74, postH = cell * 0.8;
    const postGeo = new THREE.BoxGeometry(cell * 0.08, postH, cell * 0.08);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(postGeo, metalMat, (sx * spanW) / 2, postH / 2, (sz * spanD) / 2);
      }
    }
    // top frame: two rails + a crossbeam
    box(new THREE.BoxGeometry(spanW + cell * 0.08, cell * 0.07, cell * 0.1), metalMat, 0, postH, -spanD / 2);
    box(new THREE.BoxGeometry(spanW + cell * 0.08, cell * 0.07, cell * 0.1), metalMat, 0, postH, spanD / 2);
    box(new THREE.BoxGeometry(cell * 0.1, cell * 0.07, spanD), trimMat, 0, postH, 0);
    // the tool block hangs from the crossbeam over a work floor
    box(new THREE.BoxGeometry(cell * 0.04, cell * 0.18, cell * 0.04), trimMat, 0, postH - cell * 0.12, 0, false); // hoist cable
    const tool = new THREE.Mesh(new THREE.BoxGeometry(cell * 0.22, cell * 0.16, cell * 0.22), lightMat);
    tool.position.set(0, postH - cell * 0.29, 0);
    tool.castShadow = true;
    group.add(tool);
    box(new THREE.BoxGeometry(spanW * 0.9, cell * 0.04, spanD * 0.9), trimMat, 0, cell * 0.02, 0, false); // work floor
  }

  // a small shared status beacon for the variants whose "screen" is dim
  // geometry otherwise (the printer's bars double as its beacon; the
  // fabricator's core cube already rides lightMat)
  if (spec.kind !== "printer" && spec.kind !== "fabricator") {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(cell * 0.04, 10, 8), lightMat);
    beacon.position.set(-w * 0.32, spec.kind === "roverbay" ? cell * 0.66 : cell * 0.86, -d * 0.3);
    group.add(beacon);
  }

  function setStatus(status: BuildingStatus, pulse: number, env?: KitEnv): void {
    const night = env?.night ?? 0;
    const color = statusGlow(status.alive, status.hurt);
    const intensity = (0.35 + 0.55 * pulse) * (status.alive ? 1 + 1.2 * night : 1);
    applyGlow(lightMat, color, intensity);
    // the printer's bar segments chase left→right while alive, freeze dim when
    // not; the fabricator's are a GAUGE — they light steadily as status.fill
    // (replication progress) climbs, so a yard of staggered countdowns reads
    for (let i = 0; i < barMats.length; i++) {
      let seg: number;
      if (spec.kind === "fabricator") {
        const lit = (status.fill ?? 0) * barMats.length > i;
        seg = !status.alive ? 0.12 : lit ? 1.15 : 0.22;
      } else {
        const phase = (pulse + i / barMats.length) % 1;
        seg = status.alive ? 0.35 + 0.9 * phase : 0.12;
      }
      applyGlow(barMats[i], color, seg);
    }
  }

  function dispose(): void {
    disposeObject(group);
  }

  return { object: group, setStatus, dispose };
};
