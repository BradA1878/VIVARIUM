import { describe, expect, it } from "vitest";
import { app } from "./app";

describe("agent server", () => {
  it("exposes a side-effect-free health route", async () => {
    const response = await app.request("/api/health");
    const body = await response.json() as {
      ok: boolean;
      liveNarrator: boolean;
      model: string;
      mongo: boolean;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.liveNarrator).toBe("boolean");
    expect(typeof body.mongo).toBe("boolean");
    expect(body.model.length).toBeGreaterThan(0);
  });
});
