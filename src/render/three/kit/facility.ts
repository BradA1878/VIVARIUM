/* ============================================================================
   Facility — one builder for the industrial fabrication family, switched by a
   specFor(id) the way tank.ts keys its vessels:

     printer     — a boxy printer with a reciprocating out-feed tray and
                   front status-bar lights that pulse while it runs (the 3D
                   Printer, and the Bio Printer in green)
     roverbay    — a garage: a wide low box with a recessed emissive door slab
                   on the def's door side and a shallow ramp out of it
     roboticsbay — a gantry: four corner posts under a top frame, with a tool
                   and crossbeam traversing the rails over the work floor
     atomic      — the Atomic Printer: twin extruder towers over an emissive
                   core, with front status segments that chase while it runs;
                   sized to its 2×2 footprint

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
  kind: "printer" | "roverbay" | "roboticsbay" | "atomic";
  /** body metal hex */
  metal: string;
}

function specFor(id: string): FacilitySpec {
  switch (id) {
    case "printer":
      return { kind: "printer", metal: "#838a96" }; // steel printer
    case "bioprinter":
      return { kind: "printer", metal: "#6f8a6a" }; // the same printer, in green
    case "roverbay":
      return { kind: "roverbay", metal: "#76828e" }; // garage blue-grey
    case "atomic":
      return { kind: "atomic", metal: "#6e6a8a" }; // violet steel
    case "roboticsbay":
    default:
      return { kind: "roboticsbay", metal: "#7f8790" }; // workshop steel
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

  // Independent starting positions without consuming a shared random stream.
  // Integrating only active time keeps stops/resumes continuous and makes the
  // motion independent of both render frame rate and the status-light pulse.
  let motionPhase = ((Math.imul(ctx.seed, 0x9e3779b1) >>> 0) / 4294967296) * Math.PI * 2;
  let motionRate = 0;
  let poseMotion: ((phase: number) => void) | undefined;

  const box = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  if (spec.kind === "printer") {
    // --- boxy printer: a tall body, a hopper on top, front status bars --------
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
    const tray = box(new THREE.BoxGeometry(bodyW * 0.6, cell * 0.04, cell * 0.16), trimMat, 0, bodyH * 0.3, bodyD / 2 + cell * 0.07, false);
    tray.name = "facility-outfeed";
    motionRate = 1.1;
    poseMotion = (phase) => {
      // Retract into the housing; the extended position is the old silhouette.
      tray.position.z = bodyD / 2 + cell * (0.07 - 0.025 * (1 + Math.sin(phase)));
    };
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
  } else if (spec.kind === "atomic") {
    // --- Atomic Printer: twin extruder towers over an emissive core, front
    // status segments that chase while it runs. Every size is in units of the
    // footprint's short side, so the 2×2 reads as the same machine, larger. ---
    const u = Math.min(w, d);
    const bodyW = w * 0.72, bodyH = u * 0.42, bodyD = d * 0.72;
    box(new THREE.BoxGeometry(bodyW, bodyH, bodyD), metalMat, 0, bodyH / 2, 0); // plinth
    const towerGeo = new THREE.BoxGeometry(u * 0.14, u * 0.62, u * 0.14);
    box(towerGeo, trimMat, -bodyW * 0.32, bodyH + u * 0.31, -bodyD * 0.18);
    box(towerGeo, trimMat, bodyW * 0.32, bodyH + u * 0.31, -bodyD * 0.18);
    box(new THREE.BoxGeometry(bodyW * 0.78, u * 0.07, u * 0.14), trimMat, 0, bodyH + u * 0.58, -bodyD * 0.18); // gantry beam
    // A compact extruder rides below the beam, clear of the core and towers.
    const extruder = new THREE.Group();
    extruder.name = "facility-extruder";
    group.add(extruder);
    extruder.add(box(new THREE.BoxGeometry(u * 0.11, u * 0.07, u * 0.1), metalMat, 0, bodyH + u * 0.51, -bodyD * 0.18));
    extruder.add(box(new THREE.BoxGeometry(u * 0.035, u * 0.05, u * 0.035), trimMat, 0, bodyH + u * 0.45, -bodyD * 0.18));
    motionRate = 0.8;
    poseMotion = (phase) => { extruder.position.x = u * 0.08 * Math.sin(phase); };
    // the core — where the matter is assembled; shares the beacon glow material
    const core = new THREE.Mesh(new THREE.BoxGeometry(u * 0.26, u * 0.26, u * 0.26), lightMat);
    core.position.set(0, bodyH + u * 0.24, -bodyD * 0.18);
    core.rotation.y = Math.PI / 4;
    core.castShadow = true;
    group.add(core);
    // the front (+Z) status segments: 4 lights that chase while it runs
    const segGeo = new THREE.BoxGeometry(bodyW * 0.16, u * 0.05, u * 0.02);
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
    const carriage = new THREE.Group();
    carriage.name = "facility-gantry";
    group.add(carriage);
    const crossbeamH = cell * 0.07;
    const crossbeam = box(new THREE.BoxGeometry(cell * 0.1, crossbeamH, spanD), trimMat, 0, postH, 0);
    carriage.add(crossbeam);
    // safety-yellow hazard strip on the crossbeam's outward (top) face, sized
    // to the beam's own length and a fraction of its height; parented to the
    // beam itself so it rides the carriage's slide with no extra bookkeeping
    const trimStripH = crossbeamH * 0.3;
    const trimStripMat = materials.metal("#c9a23a", { rough: 0.55, metal: 0.3 });
    crossbeam.add(box(new THREE.BoxGeometry(cell * 0.1, trimStripH, spanD), trimStripMat, 0, crossbeamH / 2 + trimStripH / 2, 0));
    // the tool block hangs from the crossbeam over a work floor
    carriage.add(box(new THREE.BoxGeometry(cell * 0.04, cell * 0.18, cell * 0.04), trimMat, 0, postH - cell * 0.12, 0, false)); // hoist cable
    const tool = new THREE.Mesh(new THREE.BoxGeometry(cell * 0.22, cell * 0.16, cell * 0.22), lightMat);
    tool.position.set(0, postH - cell * 0.29, 0);
    tool.castShadow = true;
    carriage.add(tool);
    motionRate = 0.45;
    poseMotion = (phase) => { carriage.position.x = spanW * 0.24 * Math.sin(phase); };
    box(new THREE.BoxGeometry(spanW * 0.9, cell * 0.04, spanD * 0.9), trimMat, 0, cell * 0.02, 0, false); // work floor
  }

  poseMotion?.(motionPhase);

  // a small shared status beacon for the variants whose "screen" is dim
  // geometry otherwise (the printer's bars double as its beacon; the atomic
  // printer's core cube already rides lightMat)
  if (spec.kind !== "printer" && spec.kind !== "atomic") {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(cell * 0.04, 10, 8), lightMat);
    beacon.position.set(-w * 0.32, spec.kind === "roverbay" ? cell * 0.66 : cell * 0.86, -d * 0.3);
    group.add(beacon);
  }

  function setStatus(status: BuildingStatus, pulse: number, env?: KitEnv): void {
    const dt = env?.dt ?? 0;
    const working = (status.working ?? status.alive) && status.alive && !env?.paused;
    if (poseMotion && working && Number.isFinite(dt) && dt > 0) {
      motionPhase = (motionPhase + motionRate * dt) % (Math.PI * 2);
      poseMotion(motionPhase);
    }
    const night = env?.night ?? 0;
    const color = statusGlow(status.alive, status.hurt);
    const intensity = (0.35 + 0.55 * pulse) * (status.alive ? 1 + 1.2 * night : 1);
    applyGlow(lightMat, color, intensity);
    // the bar segments (printer and atomic printer) chase left→right while
    // alive, and freeze dim when not
    for (let i = 0; i < barMats.length; i++) {
      const phase = (pulse + i / barMats.length) % 1;
      applyGlow(barMats[i], color, status.alive ? 0.35 + 0.9 * phase : 0.12);
    }
  }

  function dispose(): void {
    disposeObject(group);
  }

  return { object: group, setStatus, dispose };
};
