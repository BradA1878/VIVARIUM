import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DOME_MERIDIANS, PV_CELLS, createDomePanelTexture, createPvCellTexture } from "./panel-textures";

const px = (t: THREE.DataTexture, x: number, y: number) => {
  const { data, width } = t.image as { data: Uint8Array; width: number };
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};
const lum = (p: number[]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];

describe("PV cell texture", () => {
  it("is a seeded sRGB grid of dark blue cells with light lines", () => {
    const a = createPvCellTexture(7), b = createPvCellTexture(7);
    expect(a.image.width).toBe(256);
    expect(a.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(Array.from(a.image.data as Uint8Array)).toEqual(Array.from(b.image.data as Uint8Array));
    const cell = 256 / PV_CELLS;
    const center = px(a, Math.floor(cell * 0.5 + cell * 0.1), Math.floor(cell * 0.5)); // inside a cell, off the bus bars
    const line = px(a, Math.floor(cell), Math.floor(cell * 0.5)); // on a vertical grid line
    expect(center[2]).toBeGreaterThan(center[0]); // blue silicon
    expect(lum(line)).toBeGreaterThan(lum(center) + 40);
    expect(Array.from(createPvCellTexture(8).image.data as Uint8Array)).not.toEqual(Array.from(a.image.data as Uint8Array));
    a.dispose(); b.dispose();
  });
});

describe("dome panel texture", () => {
  it("has meridian and ring seams as grooves and a roughness channel with a known mean", () => {
    const { texture, roughnessMean } = createDomePanelTexture(3);
    expect([texture.image.width, texture.image.height]).toEqual([256, 128]);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    const seamX = Math.round(256 / DOME_MERIDIANS) ; // first meridian after u = 0
    const panelX = Math.round(256 / DOME_MERIDIANS / 2);
    const y = Math.round(128 * 0.15); // below the first ring
    expect(px(texture, seamX, y)[0]).toBeLessThan(px(texture, panelX, y)[0]);
    expect(px(texture, panelX, Math.round(128 * 0.32))[0]).toBeLessThan(px(texture, panelX, y)[0]); // ring groove
    expect(roughnessMean).toBeGreaterThan(0.7);
    expect(roughnessMean).toBeLessThanOrEqual(1);
    texture.dispose();
  });
});
