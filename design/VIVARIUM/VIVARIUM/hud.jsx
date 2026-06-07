/* ============================================================================
   VIVARIUM — HUD (Vue's job in the doc; React here). Reads Engine.state each
   render. Never mutates the tick. Instrument-grade: hairlines, mono, sparse glow.
   ============================================================================ */

const RES = [
  { k: "power",  label: "POWER",  glyph: "\u26A1", col: "#7fd4e8", unit: "kW" },
  { k: "oxygen", label: "OXYGEN", glyph: "O\u2082", col: "#9fe0e0", unit: "kPa" },
  { k: "water",  label: "WATER",  glyph: "H\u2082O", col: "#6aa8d0", unit: "m\u00B3" },
  { k: "food",   label: "FOOD",   glyph: "\u2261",  col: "#9bb58c", unit: "kg" },
];

function fmt(n, d = 0) {
  if (n == null || !isFinite(n)) return "\u2014";
  return n.toFixed(d);
}
function clockOf(tod) {
  const h = Math.floor(tod * 24);
  const m = Math.floor((tod * 24 - h) * 60);
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
function eta(amount, net) {
  if (net >= -0.01) return null;
  const s = amount / -net;
  if (!isFinite(s)) return null;
  if (s > 600) return null;
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return m > 0 ? `${m}m${String(ss).padStart(2, "0")}` : `${ss}s`;
}

/* ---- Resource readout ----------------------------------------------------- */
function ResCell({ meta, pool, net, timer }) {
  const pct = Math.max(0, Math.min(1, pool.amount / pool.cap));
  const crit = timer != null;
  const low = pct < 0.12;
  const draining = net < -0.05;
  const e = eta(pool.amount, net);
  const flowCol = net > 0.05 ? meta.col : net < -0.05 ? "#e8784f" : "#5b6970";
  return (
    <div className={"res" + (crit ? " res-crit" : low ? " res-low" : "")}>
      <div className="res-head">
        <span className="res-label" style={{ color: meta.col }}>
          <span className="res-glyph">{meta.glyph}</span>{meta.label}
        </span>
        <span className="res-flow" style={{ color: flowCol }}>
          {net > 0.05 ? "+" : ""}{fmt(net, 1)}<span className="res-per">/s</span>
        </span>
      </div>
      <div className="res-nums">
        <span className="res-amt" style={{ color: crit ? "#e8784f" : "#d6e2e6" }}>{fmt(pool.amount)}</span>
        <span className="res-cap">/ {fmt(pool.cap)} {meta.unit}</span>
      </div>
      <div className="res-bar">
        <div className="res-fill" style={{ width: (pct * 100) + "%", background: crit ? "#e8784f" : meta.col, boxShadow: `0 0 8px ${crit ? "#e8784f" : meta.col}66` }} />
        {/* buffer tick marks */}
        <div className="res-ticks">
          {[0.25, 0.5, 0.75].map((t) => <span key={t} style={{ left: (t * 100) + "%" }} />)}
        </div>
      </div>
      <div className="res-foot">
        {crit ? <span className="res-eta crit">LETHAL IN {fmt(timer)}s</span>
          : draining && e ? <span className="res-eta">empty in {e}</span>
          : net > 0.05 ? <span className="res-eta pos">surplus</span>
          : <span className="res-eta dim">holding</span>}
      </div>
    </div>
  );
}

/* ---- Crew readout --------------------------------------------------------- */
function Crew({ s }) {
  const laborFree = s.labor - s.laborUsed;
  return (
    <div className="crew">
      <div className="crew-row">
        <span className="crew-k">CREW</span>
        <span className="crew-v">{s.population}<span className="crew-sub">/{s.housing} berths</span></span>
      </div>
      <div className="crew-row">
        <span className="crew-k">LABOR</span>
        <span className="crew-v" style={{ color: laborFree < 0 ? "#e8784f" : "#d6e2e6" }}>
          {s.laborUsed}<span className="crew-sub">/{s.labor} assigned</span>
        </span>
      </div>
      {s.dead > 0 && <div className="crew-row"><span className="crew-k" style={{ color: "#e8784f" }}>LOST</span><span className="crew-v" style={{ color: "#e8784f" }}>{s.dead}</span></div>}
    </div>
  );
}

/* ---- Sol clock + weather -------------------------------------------------- */
function SolClock({ s }) {
  const day = s.tod > 0.22 && s.tod < 0.80;
  const storm = s.weather === "dust";
  const ang = s.tod * 2 * Math.PI - Math.PI / 2;
  return (
    <div className="clock">
      <div className="clock-dial">
        <svg viewBox="0 0 56 56" width="56" height="56">
          <circle cx="28" cy="28" r="25" fill="none" stroke="rgba(127,212,232,0.14)" strokeWidth="1" />
          {/* day arc */}
          <path d={arcPath(28, 28, 25, 0.22, 0.80)} fill="none" stroke="rgba(200,121,79,0.5)" strokeWidth="2" />
          {/* sun/marker */}
          <circle cx={28 + 25 * Math.cos(ang)} cy={28 + 25 * Math.sin(ang)} r="3"
            fill={day ? (storm ? "#c8794f" : "#7fd4e8") : "#3a464c"}
            style={{ filter: day ? "drop-shadow(0 0 4px currentColor)" : "none" }} />
          <text x="28" y="25" textAnchor="middle" className="clock-sol">SOL</text>
          <text x="28" y="38" textAnchor="middle" className="clock-num">{s.sol}</text>
        </svg>
      </div>
      <div className="clock-info">
        <div className="clock-time">{clockOf(s.tod)}</div>
        <div className="clock-phase">{day ? (s.tod < 0.5 ? "MORNING" : "AFTERNOON") : (s.tod > 0.84 || s.tod < 0.20 ? "NIGHT" : "TWILIGHT")}</div>
        <div className={"clock-wx" + (storm ? " storm" : "")}>
          {storm ? `\u26C8 DUST STORM \u00B7 ${fmt(s.stormT)}s` : `\u25CB CLEAR \u00B7 solar ${fmt(s.solarMul * 100)}%`}
        </div>
      </div>
    </div>
  );
}
function arcPath(cx, cy, r, t0, t1) {
  const a0 = t0 * 2 * Math.PI - Math.PI / 2, a1 = t1 * 2 * Math.PI - Math.PI / 2;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = (t1 - t0) > 0.5 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

/* ---- Build palette -------------------------------------------------------- */
function Palette({ tool, onPick, onDemolish, demolish }) {
  const defs = window.Engine.ORDER.map((id) => window.Engine.DEFS[id]);
  return (
    <div className="palette">
      <div className="pal-title">CONSTRUCT</div>
      <div className="pal-grid">
        {defs.map((d) => {
          const sel = tool === d.id && !demolish;
          return (
            <button key={d.id} className={"pal-btn" + (sel ? " sel" : "")}
              onClick={() => onPick(d.id)}
              onMouseEnter={(e) => showTip(e, d)}
              onMouseLeave={hideTip}>
              <span className="pal-glyph">{d.glyph}</span>
              <span className="pal-name">{d.name}</span>
            </button>
          );
        })}
        <button className={"pal-btn demo" + (demolish ? " sel" : "")} onClick={onDemolish}>
          <span className="pal-glyph">✕</span>
          <span className="pal-name">Demolish</span>
        </button>
      </div>
    </div>
  );
}

let tipEl = null;
function showTip(e, d) {
  hideTip();
  tipEl = document.createElement("div");
  tipEl.className = "pal-tip";
  const cons = Object.entries(d.consumes).map(([k, v]) => `\u2212${v} ${k}`).join("  ");
  const prod = Object.entries(d.produces).map(([k, v]) => `+${v} ${k}`).join("  ");
  const caps = d.caps ? Object.entries(d.caps).map(([k, v]) => `+${v} ${k} cap`).join("  ") : "";
  tipEl.innerHTML = `<div class="tip-name">${d.name} <span>${d.foot[0]}\u00D7${d.foot[1]}</span></div>
    <div class="tip-desc">${d.desc}</div>
    <div class="tip-stats">
      ${d.solar ? `<span class="tip-prod">+${d.solar} power (solar)</span>` : ""}
      ${prod ? `<span class="tip-prod">${prod}</span>` : ""}
      ${cons ? `<span class="tip-cons">${cons}</span>` : ""}
      ${caps ? `<span class="tip-cap">${caps}</span>` : ""}
      ${d.staffing ? `<span class="tip-staff">${d.staffing} crew</span>` : ""}
      ${d.requiresPressure ? `<span class="tip-press">sealed</span>` : ""}
    </div>`;
  document.body.appendChild(tipEl);
  const r = e.currentTarget.getBoundingClientRect();
  tipEl.style.left = r.left + "px";
  tipEl.style.bottom = (window.innerHeight - r.top + 8) + "px";
}
function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }

/* ---- VIVARIUM terminal ---------------------------------------------------- */
function Terminal({ messages }) {
  const ref = React.useRef(null);
  React.useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [messages]);
  return (
    <div className="term">
      <div className="term-head">
        <span className="term-eye" />
        <span className="term-id">VIVARIUM</span>
        <span className="term-status">OBSERVING</span>
      </div>
      <div className="term-body" ref={ref}>
        {messages.map((m) => (
          <div key={m.id} className="term-line">
            <span className="term-ts">[{m.sol}.{m.clock}]</span>
            <TypedText text={m.text} done={m.done} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TypedText({ text, done }) {
  const [n, setN] = React.useState(done ? text.length : 0);
  React.useEffect(() => {
    if (done) { setN(text.length); return; }
    let i = 0; setN(0);
    const id = setInterval(() => { i += 1; setN(i); if (i >= text.length) clearInterval(id); }, 16);
    return () => clearInterval(id);
  }, [text]);
  return <span className="term-txt">{text.slice(0, n)}{n < text.length && <span className="term-caret">█</span>}</span>;
}

/* ---- Alerts --------------------------------------------------------------- */
function Alerts({ s }) {
  const items = [];
  if (s.weather === "dust") items.push({ k: "storm", sev: 2, txt: `DUST STORM \u2014 solar at ${fmt(s.solarMul * 100)}%`, sub: `clears in ${fmt(s.stormT)}s` });
  for (const r of ["oxygen", "water", "food"]) {
    if (s.timers[r] != null) items.push({ k: r, sev: 3, txt: `${r.toUpperCase()} DEPLETED`, sub: `lethal in ${fmt(s.timers[r])}s` });
  }
  // brownout: any sealed consumer offline for power
  const brown = s.buildings.some((b) => b.def.requiresPressure && b.connected && b.staffed && b.fed && !b.online && (b.def.consumes.power > 0));
  if (brown) items.push({ k: "brown", sev: 2, txt: "BROWNOUT \u2014 load shed", sub: "demand exceeds supply" });
  if (!items.length) return null;
  return (
    <div className="alerts">
      {items.sort((a, b) => b.sev - a.sev).map((it) => (
        <div key={it.k} className={"alert sev" + it.sev}>
          <span className="alert-bar" />
          <div><div className="alert-txt">{it.txt}</div><div className="alert-sub">{it.sub}</div></div>
        </div>
      ))}
    </div>
  );
}

/* ---- Inspector (selected tool) -------------------------------------------- */
function Inspector({ tool, demolish }) {
  if (demolish) return <div className="inspect demo">DEMOLISH — click a structure to remove · right-click to cancel</div>;
  if (!tool) return null;
  const d = window.Engine.DEFS[tool];
  return (
    <div className="inspect">
      <span className="ins-glyph">{d.glyph}</span>
      <span className="ins-name">PLACING {d.name.toUpperCase()}</span>
      <span className="ins-hint">click to place · right-click to cancel</span>
    </div>
  );
}

/* ---- Top bar -------------------------------------------------------------- */
function TopBar({ s, onPause, onSpeed, onReset, onStorm }) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        <span className="brand-name">VIVARIUM</span>
        <span className="brand-sub">life-support console · colony 7-MX</span>
      </div>
      <div className="controls">
        <button className="ctl" onClick={onStorm} title="Force a dust storm">⛈ storm</button>
        <button className="ctl" onClick={onReset} title="Restart colony">↺ reset</button>
        <div className="ctl-sep" />
        <button className={"ctl" + (s.paused ? " on" : "")} onClick={onPause}>{s.paused ? "\u25B6 resume" : "\u275A\u275A pause"}</button>
        {[1, 2, 4].map((sp) => (
          <button key={sp} className={"ctl spd" + (s.speed === sp && !s.paused ? " on" : "")} onClick={() => onSpeed(sp)}>{sp}×</button>
        ))}
      </div>
    </div>
  );
}

window.HUD = { RES, ResCell, Crew, SolClock, Palette, Terminal, Alerts, Inspector, TopBar, clockOf };
