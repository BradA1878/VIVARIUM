import { expect, test, type Page } from "@playwright/test";
import type { Mesh, Object3D } from "three";
import type { SimBridge } from "../src/worker/bridge";
import type { GridSpace } from "../src/render/three/coords";

type SiteMesh = { object: Object3D };
type DebugWindow = Window & {
  __viv: {
    bridge: SimBridge;
    renderer: {
      grid: GridSpace;
      deposits: Map<number, SiteMesh>;
      vents: Map<number, SiteMesh>;
      aquifers: Map<number, SiteMesh>;
    };
  };
  __siteGeometryDisposed?: boolean;
};

async function startColony(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".boot")?.click());
  await page.getByRole("button", { name: "BEGIN", exact: true }).click();
  await page.waitForFunction(() => (window as DebugWindow).__viv?.bridge.latest?.started);
  await page.evaluate(() => (window as DebugWindow).__viv.bridge.setPaused(true));
}

async function expectSitesAligned(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const { bridge, renderer } = (window as DebugWindow).__viv;
    const snap = bridge.latest!;
    return (["deposits", "vents", "aquifers"] as const).every((kind) =>
      snap[kind].length > 0 && snap[kind].every((site) => {
        const object = renderer[kind].get(site.id)?.object;
        return !!object && object.position.distanceTo(renderer.grid.cellCenter(site.gx, site.gy)) < 1e-8;
      }));
  })).toBe(true);
}

test("equal-ID sites move on load and a changed deposit kind replaces its disposed mesh", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  await startColony(page);
  await page.evaluate(async () => {
    const { bridge } = (window as DebugWindow).__viv;
    const save = await bridge.save();
    save.state.paused = true;
    save.state.world = "mars";
    // Valid, distinct empty cells, away from the established opening. IDs are
    // deliberately reused in the second fixture, as real colonies reuse them.
    save.state.deposits = [{ id: 1, gx: 1, gy: 2, kind: "ore", amount: 40, max: 40 }];
    save.state.vents = [{ id: 1, gx: 2, gy: 3 }];
    save.state.aquifers = [{ id: 1, gx: 3, gy: 1 }];
    for (const actor of [...save.state.colonists, ...save.state.robots]) {
      actor.gatherDepositId = null;
      actor.gatherT = 0;
    }
    await bridge.load(save);
  });
  await expectSitesAligned(page);
  const oldUuid = await page.evaluate(() => {
    const w = window as DebugWindow;
    const object = w.__viv.renderer.deposits.get(1)!.object;
    w.__siteGeometryDisposed = false;
    const rock = object.children[0].children[0] as Mesh;
    rock.geometry.addEventListener("dispose", () => { w.__siteGeometryDisposed = true; });
    return object.uuid;
  });
  await page.evaluate(async () => {
    const { bridge } = (window as DebugWindow).__viv;
    const save = await bridge.save();
    const n = save.state.N;
    save.state.world = "io";
    save.state.deposits = [{ id: 1, gx: n - 11, gy: n - 10, kind: "cache", amount: 40, max: 40 }];
    save.state.vents = [{ id: 1, gx: n - 9, gy: n - 8 }];
    save.state.aquifers = [{ id: 1, gx: n - 7, gy: n - 6 }];
    await bridge.load(save);
  });
  await expectSitesAligned(page);
  const replaced = await page.evaluate(() => {
    const w = window as DebugWindow;
    const object = w.__viv.renderer.deposits.get(1)!.object;
    return {
      uuid: object.uuid,
      geometry: (object.children[0].children[0] as Mesh).geometry.type,
      disposed: w.__siteGeometryDisposed,
      world: w.__viv.bridge.latest!.world,
    };
  });
  expect(replaced.world).toBe("io");
  expect(replaced.uuid).not.toBe(oldUuid);
  expect(replaced.geometry).toBe("BoxGeometry"); // the cache crate, not an ore rock
  expect(replaced.disposed).toBe(true);
});

test("same-world reset follows the new seed's deposit, vent and aquifer positions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  await startColony(page);
  const positions: number[][][] = [];
  for (const seed of [7324, 7325]) {
    positions.push(await page.evaluate(async (nextSeed) => {
      const { bridge } = (window as DebugWindow).__viv;
      bridge.reset("normal", nextSeed, "mars");
      bridge.setPaused(true);
      // Save acknowledgment follows reset/pause in the worker command stream.
      const save = await bridge.save();
      return [save.state.deposits[0], save.state.vents[0], save.state.aquifers[0]]
        .map((site) => [site.id, site.gx, site.gy]);
    }, seed));
    await expectSitesAligned(page);
  }
  for (let i = 0; i < 3; i++) {
    expect(positions[1][i][0]).toBe(positions[0][i][0]);
    expect(positions[1][i].slice(1)).not.toEqual(positions[0][i].slice(1));
  }
});
