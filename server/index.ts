/* ============================================================================
   VIVARIUM — the agent-layer server (Node + Hono). A thin endpoint the narrator
   calls; the engine never needs it to run (doc §1, §0). Hosts the live MXF
   narrator (Phase 8) and, in Phase 9, Mongo-backed persistence. The provider key
   lives here and never ships to the client.
   ============================================================================ */
import { serve } from "@hono/node-server";
import { app } from "./app";
import { liveAvailable } from "./mxf/claude";

const port = Number(process.env.PORT) || 8787;
const server = serve({ fetch: app.fetch, port });
console.log(`[vivarium] agent server on :${port}  ·  live narrator: ${liveAvailable() ? "on" : "off (no ANTHROPIC_API_KEY)"}`);

let closing = false;
function shutdown(signal: NodeJS.Signals): void {
  if (closing) return;
  closing = true;
  console.log(`[vivarium] ${signal} — closing agent server`);
  server.close((err) => {
    if (err) {
      console.error("[vivarium] graceful shutdown failed:", err);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
