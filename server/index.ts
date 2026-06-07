/* ============================================================================
   VIVARIUM — the agent-layer server (Node + Hono). A thin endpoint the narrator
   calls; the engine never needs it to run (doc §1, §0). Hosts the live MXF
   narrator (Phase 8) and, in Phase 9, Mongo-backed persistence. The provider key
   lives here and never ships to the client.
   ============================================================================ */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { narrate } from "./routes/narrate";
import { NARRATOR_MODEL } from "./mxf/claude";
import { liveAvailable } from "./mxf/claude";

const app = new Hono();

app.get("/api/health", (c) =>
  c.json({ ok: true, liveNarrator: liveAvailable(), model: NARRATOR_MODEL }),
);

app.route("/api", narrate);

const port = Number(process.env.PORT) || 8787;
serve({ fetch: app.fetch, port });
console.log(`[vivarium] agent server on :${port}  ·  live narrator: ${liveAvailable() ? "on" : "off (no ANTHROPIC_API_KEY)"}`);

export { app };
