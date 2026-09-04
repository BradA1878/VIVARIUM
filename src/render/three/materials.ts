/* ============================================================================
   Shared material library for the building kit. Weathered industrial metal,
   frosted pressurized domes, tinted glass, and the status-glow emissive that
   reads a building's health (cyan = alive, rust = hurt) — the 3D analogue of the
   prototype's metalRamp / glowColor (render.js).
   ============================================================================ */
import * as THREE from "three";
import { createSurfaceDetail, roughnessWithDetail } from "./surface-detail";

/** signal accent — VIVARIUM's cyan; rust = warning/hurt (doc §4.1) */
export const CYAN = new THREE.Color("#7fd4e8");
export const RUST = new THREE.Color("#e8784f");
export const GLOW_OFF = new THREE.Color("#16202a");

export interface MaterialLib {
  /** weathered metal — pass a base hex; each call returns a fresh instance so
   *  callers can tweak without side effects */
  metal(base?: THREE.ColorRepresentation, opts?: { rough?: number; metal?: number }): THREE.MeshStandardMaterial;
  /** frosted pressurized dome skin — faintly translucent, soft */
  frostedDome(base?: THREE.ColorRepresentation): THREE.MeshStandardMaterial;
  /** dark glassy panel (solar) */
  panel(): THREE.MeshStandardMaterial;
  /** an emissive "service light / hatch" material; update with setGlow() */
  glow(color?: THREE.ColorRepresentation): THREE.MeshStandardMaterial;
  /** Release the shared finish map after the individual kit materials. */
  dispose(): void;
}

export function createMaterials(): MaterialLib {
  // Individual materials belong to their kits; this one map belongs to the
  // library and survives building removal and world changes.
  const detail = createSurfaceDetail("metal", 0x6d657461);
  return {
    metal(base = "#7a828c", opts = {}) {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(base),
        ...roughnessWithDetail(opts.rough ?? 0.62, detail),
        metalness: opts.metal ?? 0.72,
        flatShading: false,
      });
    },
    frostedDome(base = "#787f8a") {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(base),
        ...roughnessWithDetail(0.4, detail),
        metalness: 0.35,
        transparent: true,
        opacity: 0.92,
      });
    },
    panel() {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color("#1d2838"),
        roughness: 0.22,
        metalness: 0.85,
        emissive: new THREE.Color("#0a1422"),
        emissiveIntensity: 0.4,
      });
    },
    glow(color: THREE.ColorRepresentation = GLOW_OFF) {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color("#10161c"),
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.9,
        roughness: 0.5,
        metalness: 0.2,
      });
    },
    dispose() {
      detail.texture.dispose();
    },
  };
}

/** the status colour a building's glow should pulse (prototype glowColor) */
export function statusGlow(alive: boolean, hurt: boolean): THREE.Color {
  if (hurt) return RUST;
  if (alive) return CYAN;
  return GLOW_OFF;
}

/** drive an emissive material toward a status colour at a pulse intensity */
export function applyGlow(mat: THREE.MeshStandardMaterial, color: THREE.Color, intensity: number): void {
  mat.emissive.copy(color);
  mat.emissiveIntensity = intensity;
}
