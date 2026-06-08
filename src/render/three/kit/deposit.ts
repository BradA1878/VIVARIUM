/* ============================================================================
   Deposits — the surface resource nodes colonists mine. One mesh per snapshot
   deposit, scaled by amount/max so a node visibly shrinks as it's worked out.
   Per kind:
     ice   — a cluster of bluish icosahedra, emissive cyan (frozen volatiles)
     ore   — a dark angular rock with a few bright orange specks
     cache — a small green-accented crate box (a dropped supply pod)
   Kept visually distinct from buildings (geometric, faceted) and terrain rocks
   (these glow). The renderer owns per-id lifecycle; this owns geometry/material.
   ============================================================================ */
import * as THREE from "three";
import type { DepositKind } from "@shared/types";
import { disposeObject, greebleRng } from "./contract";

export interface DepositMesh {
  object: THREE.Group;
  /** scale the cluster to fraction (amount/max), 0..1 */
  setAmount(frac: number): void;
  /** drive the emissive shimmer */
  setPulse(pulse: number): void;
  dispose(): void;
}

export function buildDeposit(kind: DepositKind, seed: number): DepositMesh {
  const object = new THREE.Group();
  // an inner group we scale by amount, so the base stays planted on the ground
  const cluster = new THREE.Group();
  object.add(cluster);
  const rng = greebleRng(seed);

  const emissiveMats: THREE.MeshStandardMaterial[] = [];

  if (kind === "ice") {
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0x9fdff0,
      emissive: 0x2e7f96,
      emissiveIntensity: 0.6,
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity: 0.9,
      flatShading: true,
    });
    emissiveMats.push(iceMat);
    const shards = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < shards; i++) {
      const r = 0.1 + rng() * 0.13;
      const geo = new THREE.IcosahedronGeometry(r, 0);
      const m = new THREE.Mesh(geo, iceMat);
      m.position.set((rng() - 0.5) * 0.4, r * 0.8, (rng() - 0.5) * 0.4);
      m.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      m.castShadow = true;
      cluster.add(m);
    }
  } else if (kind === "ore") {
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x3a322c,
      roughness: 0.9,
      metalness: 0.2,
      flatShading: true,
    });
    const rockGeo = new THREE.DodecahedronGeometry(0.26, 0);
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.y = 0.16;
    rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    rock.scale.set(1, 0.8, 1);
    rock.castShadow = true;
    cluster.add(rock);
    // bright ore specks embedded in the rock
    const speckMat = new THREE.MeshStandardMaterial({
      color: 0xe0913a,
      emissive: 0xe0913a,
      emissiveIntensity: 0.9,
      roughness: 0.4,
      metalness: 0.3,
    });
    emissiveMats.push(speckMat);
    const specks = 3 + Math.floor(rng() * 3);
    const speckGeo = new THREE.OctahedronGeometry(0.05, 0);
    for (let i = 0; i < specks; i++) {
      const s = new THREE.Mesh(speckGeo, speckMat);
      const th = rng() * Math.PI * 2;
      const ph = rng() * Math.PI;
      s.position.set(
        Math.sin(ph) * Math.cos(th) * 0.22,
        0.16 + Math.cos(ph) * 0.18,
        Math.sin(ph) * Math.sin(th) * 0.22,
      );
      cluster.add(s);
    }
  } else {
    // cache — a supply crate with green accent panels
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x556152,
      roughness: 0.65,
      metalness: 0.35,
    });
    const crateGeo = new THREE.BoxGeometry(0.32, 0.26, 0.32);
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.y = 0.13;
    crate.castShadow = true;
    cluster.add(crate);
    // glowing green accent strips on top
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x6fcf7f,
      emissive: 0x6fcf7f,
      emissiveIntensity: 0.85,
      roughness: 0.4,
      metalness: 0.2,
    });
    emissiveMats.push(accentMat);
    const accentGeo = new THREE.BoxGeometry(0.34, 0.04, 0.06);
    for (let i = 0; i < 2; i++) {
      const a = new THREE.Mesh(accentGeo, accentMat);
      a.position.set(0, 0.27, -0.08 + i * 0.16);
      cluster.add(a);
    }
  }

  return {
    object,
    setAmount(frac) {
      // never fully vanish before removal; floor the visible size
      const s = 0.45 + 0.55 * Math.max(0, Math.min(1, frac));
      cluster.scale.setScalar(s);
    },
    setPulse(pulse) {
      for (const m of emissiveMats) {
        m.emissiveIntensity = 0.5 + 0.5 * pulse;
      }
    },
    dispose() {
      disposeObject(object);
    },
  };
}
