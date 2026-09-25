/* ============================================================================
   Shared material library for the building kit. Weathered industrial metal,
   frosted pressurized domes, tinted glass, and the status-glow emissive that
   reads a building's health (cyan = alive, rust = hurt) — the 3D analogue of the
   prototype's metalRamp / glowColor (render.js).
   ============================================================================ */
import * as THREE from "three";
import { createSurfaceDetail, roughnessWithDetail } from "./surface-detail";
import { createDomePanelTexture, createPvCellTexture } from "./panel-textures";

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
  /** a dome cap's shell with shared panel seams */
  domeShell(base?: THREE.ColorRepresentation): THREE.MeshStandardMaterial;
  /** PV glass with the shared cell map */
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
  const pv = createPvCellTexture(0x5e11);
  const dome = createDomePanelTexture(0xd0e5);
  return {
    metal(base = "#7a828c", opts = {}) {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(base),
        ...roughnessWithDetail(opts.rough ?? 0.62, detail),
        metalness: opts.metal ?? 0.6,
        flatShading: false,
      });
    },
    frostedDome(base = "#787f8a") {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(base),
        ...roughnessWithDetail(0.5, detail),
        metalness: 0.2,
        transparent: true,
        opacity: 0.92,
      });
    },
    domeShell(base = "#787f8a") {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(base),
        roughness: Math.min(1, 0.5 / dome.roughnessMean),
        roughnessMap: dome.texture,
        bumpMap: dome.texture,
        bumpScale: 1.5,
        metalness: 0.2,
        transparent: true,
        opacity: 0.92,
      });
    },
    panel() {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xffffff),
        map: pv,
        roughness: 0.18,
        metalness: 0.1,
        emissive: new THREE.Color(0x050b14),
        emissiveIntensity: 0.3,
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
      pv.dispose();
      dome.texture.dispose();
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
