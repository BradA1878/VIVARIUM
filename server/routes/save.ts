/* ============================================================================
   Persistence routes (doc §5). POST /api/save stores a save by slot; GET
   /api/load?slot= returns it. Mongo-backed; both 503 when Mongo is down so the
   client uses localStorage. Save state is tiny — a single document per slot.
   ============================================================================ */
import { Hono } from "hono";
import { saves } from "../db/mongo";

export const persistence = new Hono();

persistence.post("/save", async (c) => {
  const col = await saves();
  if (!col) return c.json({ error: "persistence unavailable", fallback: "local" }, 503);

  let body: { slot?: string; save?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad request" }, 400);
  }
  const slot = typeof body.slot === "string" ? body.slot : "default";
  if (!body.save || typeof body.save !== "object") {
    return c.json({ error: "missing save" }, 400);
  }

  try {
    await col.updateOne(
      { slot },
      { $set: { slot, save: body.save, updatedAt: new Date() } },
      { upsert: true },
    );
    return c.json({ ok: true });
  } catch (err) {
    console.warn("[save] write failed:", (err as Error).message);
    return c.json({ error: "write failed", fallback: "local" }, 503);
  }
});

persistence.get("/load", async (c) => {
  const col = await saves();
  if (!col) return c.json({ error: "persistence unavailable", fallback: "local" }, 503);

  const slot = c.req.query("slot") || "default";
  try {
    const doc = await col.findOne({ slot });
    return c.json({ save: doc?.save ?? null });
  } catch (err) {
    console.warn("[load] read failed:", (err as Error).message);
    return c.json({ error: "read failed", fallback: "local" }, 503);
  }
});
