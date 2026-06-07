/* ============================================================================
   VIVARIUM — APP. Wires the engine loop <-> imperative canvas <-> React HUD.
   The loop calls Engine.tick(dt); the agent layer only observes events. (Doc §0.)
   ============================================================================ */
const { useState, useEffect, useRef, useCallback } = React;
const H = window.HUD;

function App() {
  const [, setFrame] = useState(0);
  const [tool, setTool] = useState(null);
  const [demolish, setDemolish] = useState(false);
  const [messages, setMessages] = useState([]);
  const [booting, setBooting] = useState(true);
  const canvasRef = useRef(null);
  const msgId = useRef(1);

  const pushLine = useCallback((text) => {
    const s = window.Engine.state;
    setMessages((m) => {
      const next = [...m, { id: msgId.current++, text, sol: s ? s.sol : 1, clock: H.clockOf(s ? s.tod : 0) }];
      return next.slice(-40);
    });
  }, []);

  // ---- init once -----------------------------------------------------------
  useEffect(() => {
    window.Render.init(canvasRef.current);
    window.Render.onPlaced(() => { /* keep tool active for repeat placement */ });
    window.Render.onCancel(() => { setTool(null); setDemolish(false); });

    // agent layer observes the event stream — async-style, out of the tick
    window.Engine.onEvent((e) => {
      const line = window.Vivarium.observe(e, window.Engine.state.t);
      if (line) pushLine(line);
    });

    // boot voice
    const boot = window.Vivarium.bootLines();
    setTimeout(() => pushLine(boot[Math.floor(Math.random() * boot.length)]), 900);

    // the loop: a fixed interval drives the sim AND the canvas, so it advances
    // even when the tab is backgrounded (rAF is throttled to zero when hidden).
    let last = performance.now();
    let acc = 0;
    const step = () => {
      const now = performance.now();
      let dt = (now - last) / 1000; last = now;
      if (dt > 0.1) dt = 0.1;            // guard against tab-switch / throttle jumps
      window.Engine.tick(dt);
      window.Render.draw();
      acc += dt;
      if (acc > 0.08) { acc = 0; setFrame((f) => (f + 1) % 1e9); }  // ~12 fps HUD
    };
    const intv = setInterval(step, 1000 / 30);

    const t = setTimeout(() => setBooting(false), 2600);
    return () => { clearInterval(intv); clearTimeout(t); };
  }, [pushLine]);

  // ---- tool wiring ---------------------------------------------------------
  const pick = (id) => {
    if (tool === id && !demolish) { setTool(null); window.Render.clearTool(); return; }
    setTool(id); setDemolish(false); window.Render.setPlacing(id);
  };
  const toggleDemolish = () => {
    const v = !demolish; setDemolish(v); setTool(null);
    if (v) window.Render.setDemolish(true); else window.Render.clearTool();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { setTool(null); setDemolish(false); window.Render.clearTool(); }
      if (e.key === " ") { e.preventDefault(); window.Engine.setPaused(!window.Engine.state.paused); setFrame((f) => f + 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const s = window.Engine.state;
  if (!s) return null;

  return (
    <div className="app">
      <canvas ref={canvasRef} className="stage" />
      <div className="vignette" />

      <div className="hud">
        <H.TopBar s={s}
          onPause={() => { window.Engine.setPaused(!s.paused); setFrame((f) => f + 1); }}
          onSpeed={(sp) => { window.Engine.setPaused(false); window.Engine.setSpeed(sp); setFrame((f) => f + 1); }}
          onReset={() => { window.Engine.reset(); window.Vivarium.reset(); setMessages([]); setTool(null); setDemolish(false); window.Render.clearTool(); }}
          onStorm={() => window.Engine.forceStorm()} />

        <div className="left-col">
          <div className="panel rail">
            <SolClockWrap s={s} />
            <div className="rail-res">
              {H.RES.map((meta) => (
                <H.ResCell key={meta.k} meta={meta} pool={s.pools[meta.k]} net={s.flow[meta.k]} timer={s.timers[meta.k]} />
              ))}
            </div>
            <H.Crew s={s} />
          </div>
        </div>

        <div className="right-col">
          <H.Alerts s={s} />
        </div>

        <div className="bottom-left">
          <H.Terminal messages={messages} />
        </div>

        <div className="bottom-center">
          <H.Inspector tool={tool} demolish={demolish} />
          <H.Palette tool={tool} demolish={demolish} onPick={pick} onDemolish={toggleDemolish} />
        </div>
      </div>

      {booting && <Boot onDone={() => setBooting(false)} />}
    </div>
  );
}

function SolClockWrap({ s }) { return <H.SolClock s={s} />; }

/* ---- cold boot overlay ---------------------------------------------------- */
function Boot({ onDone }) {
  const [step, setStep] = useState(0);
  const seq = [
    "VIVARIUM life-support kernel \u2014 cold start",
    "pressure seal \u2026 nominal",
    "telemetry bus \u2026 online",
    "narrator \u2026 awake",
  ];
  useEffect(() => {
    const ids = seq.map((_, i) => setTimeout(() => setStep(i + 1), 350 + i * 420));
    return () => ids.forEach(clearTimeout);
  }, []);
  return (
    <div className="boot" onClick={onDone}>
      <div className="boot-inner">
        <div className="boot-mark">VIVARIUM</div>
        <div className="boot-log">
          {seq.slice(0, step).map((l, i) => (
            <div key={i} className="boot-row"><span>{l}</span><span className="boot-ok">OK</span></div>
          ))}
        </div>
        <div className="boot-hint">click to enter</div>
      </div>
    </div>
  );
}

// engine must exist before first render so the canvas mounts
if (!window.Engine.state) window.Engine.init();
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
