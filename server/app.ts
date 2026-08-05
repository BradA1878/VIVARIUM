/* ============================================================================
   VIVARIUM agent-layer application.

   Keeping app construction separate from the Node listener makes the HTTP
   contract importable by smoke tests and other runtimes without opening a
   socket as a side effect.
   ============================================================================ */
import { Hono } from "hono";
import { mongoAvailable } from "./db/mongo";
import { liveAvailable, NARRATOR_MODEL } from "./mxf/claude";
import { narrate } from "./routes/narrate";
import { persistence } from "./routes/save";

export function createApp(): Hono {
  const app = new Hono();

  app.get("/api/health", async (c) =>
    c.json({
      ok: true,
      liveNarrator: liveAvailable(),
      model: NARRATOR_MODEL,
      mongo: await mongoAvailable(),
    }),
  );

  app.route("/api", narrate);
  app.route("/api", persistence);

  return app;
}

export const app = createApp();
