/* ============================================================================
   The simulation Web Worker. The engine lives HERE, off the main thread — the
   hard wall (doc §0) maps onto the worker boundary. This shell is deliberately
   thin: it owns a SimHost, runs the fixed-interval loop, and shuttles typed
   messages. All real logic is in host.ts (and the pure engine), which is tested.
   ============================================================================ */
import { SimHost } from "./host";
import { type Command, type Outbound, LOOP_MS } from "./protocol";

const host = new SimHost();
let last = performance.now();

function post(messages: Outbound[]): void {
  for (const m of messages) (self as DedicatedWorkerGlobalScope).postMessage(m);
}

self.onmessage = (e: MessageEvent<Command>) => {
  post(host.applyCommand(e.data));
};

// fixed-interval loop — advances even when the tab is backgrounded
setInterval(() => {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  post(host.step(dt));
}, LOOP_MS);

post([{ type: "ready" }, host.snapshotMessage()]);
