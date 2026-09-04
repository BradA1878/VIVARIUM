/** Batched soil contact, base dust, and night light spill. These meshes reuse
 *  the terrain's triangles, with soft alpha masks and depth testing; they never
 *  alter the build surface or add a real light per building. */
import * as THREE from "three";
import type { BuildingDef, World } from "@shared/types";
import type { Terrain } from "./terrain";
import { worldLook } from "./worldlook";

interface GroundRecord {
  def: BuildingDef;
  object: THREE.Object3D;
  x: number;
  z: number;
  rot: number;
  alive: boolean;
}
interface Patch {
  x: number;
  z: number;
  rx: number;
  rz: number;
  angle: number;
  color: THREE.Color;
}

function softMask(ring = false): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
    const fade = Math.max(0, 1 - r * r);
    const alpha = ring ? Math.exp(-(((r - 0.65) / 0.19) ** 2)) * fade : fade * fade;
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(255 * (r < 1 ? alpha : 0));
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Same grid diagonals/winding as PlaneGeometry rotated onto XZ. UVs rotate
 *  the mask rather than the geometry, so every patch stays flush on the soil. */
export function groundPatchGeometry(patches: readonly Patch[], terrain: Terrain): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
  const step = terrain.surfaceStep, half = terrain.surfaceHalfSpan;
  const emit = (x: number, z: number, p: Patch, cos: number, sin: number) => {
    positions.push(x, terrain.heightAt(x, z), z);
    const dx = x - p.x, dz = z - p.z;
    uvs.push((cos * dx - sin * dz) / (2 * p.rx) + 0.5, (sin * dx + cos * dz) / (2 * p.rz) + 0.5);
    colors.push(p.color.r, p.color.g, p.color.b);
  };
  for (const p of patches) {
    const radius = Math.max(p.rx, p.rz);
    const x0 = Math.max(0, Math.floor((p.x - radius + half) / step));
    const z0 = Math.max(0, Math.floor((p.z - radius + half) / step));
    const x1 = Math.min(2 * half / step, Math.ceil((p.x + radius + half) / step));
    const z1 = Math.min(2 * half / step, Math.ceil((p.z + radius + half) / step));
    const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
    for (let iz = z0; iz < z1; iz++) for (let ix = x0; ix < x1; ix++) {
      const x = ix * step - half, z = iz * step - half;
      emit(x, z, p, cos, sin); emit(x, z + step, p, cos, sin); emit(x + step, z, p, cos, sin);
      emit(x, z + step, p, cos, sin); emit(x + step, z + step, p, cos, sin); emit(x + step, z, p, cos, sin);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  if (positions.length) geometry.computeBoundingSphere();
  return geometry;
}

export class GroundDetails {
  readonly group = new THREE.Group();
  private readonly mask = softMask();
  private readonly dustMask = softMask(true);
  private readonly contact = this.makeMesh(this.mask, 0.32);
  private readonly dust = this.makeMesh(this.dustMask, 0.12);
  private readonly spill = this.makeMesh(this.mask, 0);
  private readonly records = new Map<number, GroundRecord>();
  private terrain: Terrain | null = null;
  private dirty = true;
  private lightsDirty = true;

  constructor() {
    this.group.name = "ground-details";
    this.contact.name = "contact-shadows";
    this.dust.name = "base-dust";
    this.spill.name = "night-spill";
    this.spill.material.blending = THREE.AdditiveBlending;
    this.group.add(this.contact, this.dust, this.spill);
  }

  private makeMesh(map: THREE.Texture, opacity: number): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    const material = new THREE.MeshBasicMaterial({
      map, vertexColors: true, transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.renderOrder = 1;
    mesh.visible = false;
    return mesh;
  }

  syncBuilding(uid: number, def: BuildingDef, object: THREE.Object3D, alive: boolean): void {
    const prev = this.records.get(uid);
    const { x, z } = object.position, rot = object.rotation.y;
    if (prev?.object === object && prev.x === x && prev.z === z && prev.rot === rot) {
      if (prev.alive !== alive) { prev.alive = alive; this.lightsDirty = true; }
      return;
    }
    this.records.set(uid, { def, object, x, z, rot, alive });
    this.dirty = true;
  }

  update(seen: ReadonlySet<number>, terrain: Terrain, world: World, night: number): void {
    for (const uid of this.records.keys()) if (!seen.has(uid)) {
      this.records.delete(uid);
      this.dirty = true;
    }
    if (terrain !== this.terrain) { this.terrain = terrain; this.dirty = true; }
    if (this.dirty || this.lightsDirty) {
      this.rebuild(terrain, world, this.dirty);
      this.dirty = false;
      this.lightsDirty = false;
    }
    this.spill.material.opacity = 0.2 * night;
    // Dust is reflected soil color, not an emissive ring after sundown.
    this.dust.material.opacity = 0.1 * (1 - 0.9 * night);
    this.spill.visible = night > 0.01 && this.spill.geometry.attributes.position.count > 0;
  }

  private rebuild(terrain: Terrain, world: World, layoutChanged: boolean): void {
    const contacts: Patch[] = [], dust: Patch[] = [], lights: Patch[] = [];
    const contactColor = new THREE.Color(0x080a0d);
    const dustColor = new THREE.Color(worldLook(world).ground.accent);
    const lightPosition = new THREE.Vector3();
    for (const { def, object, x, z, rot, alive } of this.records.values()) {
      const rx = def.foot[0] * 0.56, rz = def.foot[1] * 0.56;
      if (layoutChanged) contacts.push({ x, z, rx, rz, angle: rot, color: contactColor });
      // Raised solar panels and thin corridors get contact only.
      if (layoutChanged && !def.solar && !def.conduit) dust.push({ x, z, rx: rx * 1.35, rz: rz * 1.35, angle: rot, color: dustColor });
      if (!alive) continue;
      // Ignore the transient placement scale: the footprint/light source positions
      // belong to the completed building, independent of its brief scale-pop.
      const transform = new THREE.Matrix4().compose(object.position, object.quaternion, new THREE.Vector3(1, 1, 1));
      object.traverse((child) => {
        const color = child.userData.groundLight as number | undefined;
        if (color == null) return;
        lightPosition.copy(child.position);
        for (let parent = child.parent; parent && parent !== object; parent = parent.parent) {
          parent.updateMatrix();
          lightPosition.applyMatrix4(parent.matrix);
        }
        lightPosition.applyMatrix4(transform);
        const dx = lightPosition.x - x, dz = lightPosition.z - z;
        const length = Math.hypot(dx, dz) || 1;
        lights.push({ x: lightPosition.x + dx / length * 0.18, z: lightPosition.z + dz / length * 0.18,
          rx: 0.45, rz: 0.58, angle: Math.atan2(dx, dz), color: new THREE.Color(color) });
      });
    }
    for (const [mesh, patches] of [[this.contact, contacts], [this.dust, dust], [this.spill, lights]] as const) {
      if (!layoutChanged && mesh !== this.spill) continue;
      const old = mesh.geometry;
      mesh.geometry = groundPatchGeometry(patches, terrain);
      old.dispose();
      mesh.visible = patches.length > 0;
    }
  }

  dispose(): void {
    for (const mesh of [this.contact, this.dust, this.spill]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    this.mask.dispose();
    this.dustMask.dispose();
    this.records.clear();
  }
}
