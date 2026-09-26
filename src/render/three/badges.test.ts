import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { BuildingState } from "@shared/types";
import { badgeSpecs, FaultBadgeSystem, OFF_REASON_LABEL } from "./badges";

function building(overrides: Partial<BuildingState> & Pick<BuildingState, "uid" | "defId">): BuildingState {
  return {
    gx: 0, gy: 0, rot: 0,
    online: false, connected: false, staffed: false, fed: false,
    util: 0, integrity: 1, faulted: 0,
    ...overrides,
  };
}

describe("OFF_REASON_LABEL", () => {
  it("maps every OffReason to its badge text", () => {
    expect(OFF_REASON_LABEL).toEqual({
      power: "NO POWER",
      damaged: "DAMAGED",
      faulted: "FLARE FAULT",
      seal: "NO SEAL",
      crew: "NO CREW",
      water: "NO WATER",
      oxygen: "NO OXYGEN",
      food: "NO FOOD",
    });
  });
});

describe("badgeSpecs", () => {
  it("includes a building with an offReason, labeled from OFF_REASON_LABEL", () => {
    const specs = badgeSpecs([building({ uid: 5, defId: "hab", offReason: "seal" })]);
    expect(specs).toEqual([{ uid: 5, label: "NO SEAL" }]);
  });

  it("skips a building with no offReason", () => {
    expect(badgeSpecs([building({ uid: 5, defId: "hab" })])).toEqual([]);
  });

  it("skips a conduit (corridor) even with an offReason", () => {
    expect(badgeSpecs([building({ uid: 5, defId: "corridor", offReason: "power" })])).toEqual([]);
  });

  it("preserves building order across mixed reasons and skips conduits", () => {
    const specs = badgeSpecs([
      building({ uid: 1, defId: "hab", offReason: "crew" }),
      building({ uid: 2, defId: "corridor", offReason: "power" }),
      building({ uid: 3, defId: "greenhouse", offReason: "water" }),
    ]);
    expect(specs).toEqual([
      { uid: 1, label: "NO CREW" },
      { uid: 3, label: "NO WATER" },
    ]);
  });
});

describe("FaultBadgeSystem", () => {
  const stubFactory = () => new THREE.Texture();

  it("shows one sprite per spec at anchor + 0.12 and skips a null anchor", () => {
    const badges = new FaultBadgeSystem(stubFactory);
    const positions = new Map<number, THREE.Vector3>([
      [1, new THREE.Vector3(3, 1, -2)],
      [2, new THREE.Vector3(5, 2, 4)],
    ]);
    badges.sync(
      [
        { uid: 1, label: "NO POWER" },
        { uid: 2, label: "NO SEAL" },
        { uid: 99, label: "NO CREW" }, // no anchor available — skipped entirely
      ],
      (uid) => positions.get(uid) ?? null,
    );

    const sprites = badges.group.children as THREE.Sprite[];
    expect(sprites).toHaveLength(2);
    expect(sprites[0].visible).toBe(true);
    expect(sprites[0].position.toArray()).toEqual([3, 1.12, -2]);
    expect(sprites[1].visible).toBe(true);
    expect(sprites[1].position.toArray()).toEqual([5, 2.12, 4]);

    badges.dispose();
  });

  it("hides extras when specs shrink, without destroying the pooled sprites", () => {
    const badges = new FaultBadgeSystem(stubFactory);
    const pos = (n: number) => new THREE.Vector3(n, 0, 0);
    badges.sync(
      [
        { uid: 1, label: "NO POWER" },
        { uid: 2, label: "NO SEAL" },
        { uid: 3, label: "DAMAGED" },
      ],
      (uid) => pos(uid),
    );
    expect(badges.group.children).toHaveLength(3);

    badges.sync([{ uid: 1, label: "NO POWER" }], (uid) => pos(uid));

    const sprites = badges.group.children as THREE.Sprite[];
    expect(sprites).toHaveLength(3); // pool retained, not shrunk
    expect(sprites[0].visible).toBe(true);
    expect(sprites[1].visible).toBe(false);
    expect(sprites[2].visible).toBe(false);

    badges.dispose();
  });

  it("reuses pooled sprites instead of creating new ones", () => {
    const badges = new FaultBadgeSystem(stubFactory);
    const pos = (n: number) => new THREE.Vector3(n, 0, 0);
    badges.sync(
      [{ uid: 1, label: "NO POWER" }, { uid: 2, label: "NO SEAL" }],
      (uid) => pos(uid),
    );
    const first = [...badges.group.children];
    expect(first).toHaveLength(2);

    // different specs (different uid/label), so the change-key differs and
    // sync does real work — but it must reuse pool slots, not grow the group
    badges.sync([{ uid: 3, label: "DAMAGED" }], (uid) => pos(uid));

    expect(badges.group.children).toHaveLength(2);
    expect(badges.group.children[0]).toBe(first[0]);
    expect(badges.group.children[1]).toBe(first[1]);
    expect(badges.group.children[0].visible).toBe(true);
    expect(badges.group.children[1].visible).toBe(false);

    badges.dispose();
  });

  it("calls the texture factory once per distinct label, cached across syncs", () => {
    const factory = vi.fn((_label: string) => new THREE.Texture());
    const badges = new FaultBadgeSystem(factory);
    const pos = (n: number) => new THREE.Vector3(n, 0, 0);

    badges.sync(
      [
        { uid: 1, label: "NO POWER" },
        { uid: 2, label: "NO POWER" },
        { uid: 3, label: "NO SEAL" },
      ],
      (uid) => pos(uid),
    );
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledWith("NO POWER");
    expect(factory).toHaveBeenCalledWith("NO SEAL");

    // a later sync reusing an already-drawn label must not redraw it
    badges.sync(
      [{ uid: 1, label: "NO POWER" }, { uid: 4, label: "NO SEAL" }],
      (uid) => pos(uid + 10),
    );
    expect(factory).toHaveBeenCalledTimes(2);

    badges.dispose();
  });

  it("does no positional work on a repeat sync with nothing changed", () => {
    const badges = new FaultBadgeSystem(stubFactory);
    const pos = new THREE.Vector3(1, 2, 3);
    const specs = [{ uid: 1, label: "NO POWER" }];
    const anchor = () => pos;

    badges.sync(specs, anchor);

    const setSpy = vi.spyOn(THREE.Vector3.prototype, "set");
    badges.sync(specs, anchor);
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();

    badges.dispose();
  });

  it("disposes materials, cached textures, and clears the group", () => {
    const textures: THREE.Texture[] = [];
    const factory = (_label: string) => {
      const tex = new THREE.Texture();
      textures.push(tex);
      return tex;
    };
    const badges = new FaultBadgeSystem(factory);
    badges.sync(
      [{ uid: 1, label: "NO POWER" }, { uid: 2, label: "NO SEAL" }],
      (uid) => new THREE.Vector3(uid, 0, 0),
    );

    const sprites = [...badges.group.children] as THREE.Sprite[];
    const materialSpies = sprites.map((s) => vi.spyOn(s.material as THREE.SpriteMaterial, "dispose"));
    const textureSpies = textures.map((t) => vi.spyOn(t, "dispose"));

    badges.dispose();

    for (const spy of materialSpies) expect(spy).toHaveBeenCalledTimes(1);
    for (const spy of textureSpies) expect(spy).toHaveBeenCalledTimes(1);
    expect(badges.group.children).toHaveLength(0);
  });
});
