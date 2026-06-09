/* ============================================================================
   The collection depot — a clear, glowing intake hopper the possessed colonist
   walks up to and drops materials into (press P). A distinct fixture so dropping
   is an obvious, physical act, not a vague "somewhere near the base". Brightens
   when you're carrying a load and standing in range.
   ============================================================================ */
import * as THREE from "three";
import { disposeObject } from "./kit/contract";

export interface DepotMesh {
  object: THREE.Group;
  /** active: 0..1 how "ready to receive" it looks (you're carrying + in range) */
  setGlow(active: number, pulse: number): void;
  dispose(): void;
}

export function buildDepot(): DepotMesh {
  const object = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b424b, roughness: 0.6, metalness: 0.5 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x10202a, emissive: 0x7fd4e8, emissiveIntensity: 0.6, roughness: 0.4 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x7fd4e8, transparent: true, opacity: 0.4, side: THREE.DoubleSide });

  // base drum
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.22, 12), bodyMat);
  base.position.y = 0.11; base.castShadow = true; object.add(base);
  // intake funnel (wider at the top opening)
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.28, 0.26, 12, 1, true), bodyMat);
  funnel.position.y = 0.37; funnel.castShadow = true; object.add(funnel);
  // three support struts for an industrial read
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.04), bodyMat);
    strut.position.set(Math.cos(a) * 0.34, 0.12, Math.sin(a) * 0.34);
    object.add(strut);
  }
  // glowing intake rim at the top
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.038, 8, 20), rimMat);
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.5; object.add(rim);
  // glowing intake disc just inside the rim
  const intake = new THREE.Mesh(new THREE.CircleGeometry(0.4, 18), glowMat);
  intake.rotation.x = -Math.PI / 2; intake.position.y = 0.49; object.add(intake);
  // a ground ring marking the drop radius
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 32), glowMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; object.add(ring);

  return {
    object,
    setGlow(active, pulse) {
      const a = Math.max(0, Math.min(1, active));
      glowMat.opacity = 0.28 + 0.12 * pulse + a * (0.35 + 0.2 * pulse);
      rimMat.emissiveIntensity = 0.5 + a * (0.7 + 0.5 * pulse);
    },
    dispose() { disposeObject(object); },
  };
}
