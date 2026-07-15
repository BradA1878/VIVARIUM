/* ============================================================================
   The simulation Web Worker. The engine lives HERE, off the main thread — the
   hard wall (doc §0) maps onto the worker boundary. This shell is deliberately
   thin: it owns a SimHost, runs the fixed-interval loop, and shuttles typed
   messages. All real logic is in host.ts (and the pure engine), which is tested.
   ============================================================================ */
import { SimHost } from "./host";
import { type Command, type Outbound, type SimErrorContext, LOOP_MS } from "./protocol";

const host = new SimHost();
let last = performance.now();

function post(messages: Outbound[]): void {
  for (const m of messages) (self as DedicatedWorkerGlobalScope).postMessage(m);
}

// a throw must SURFACE (not silently no-op a command, not wedge the loop) —
// but a step that throws every tick would spam, so errors are rate-limited
// per context. The host keeps serving either way.
const lastErrAt: Partial<Record<SimErrorContext, number>> = {};
function postError(context: SimErrorContext, err: unknown): void {
  const now = performance.now();
  if (now - (lastErrAt[context] ?? -Infinity) < 5000) return;
  lastErrAt[context] = now;
  post([{ type: "error", context, detail: err instanceof Error ? err.message : String(err) }]);
}

self.onmessage = (e: MessageEvent<Command>) => {
  try {
    post(host.applyCommand(e.data));
  } catch (err) {
    postError("command", err);
  }
};

// fixed-interval loop — advances even when the tab is backgrounded
setInterval(() => {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  try {
    post(host.step(dt));
  } catch (err) {
    postError("step", err);
  }
}, LOOP_MS);

post([{ type: "ready" }, host.snapshotMessage()]);
