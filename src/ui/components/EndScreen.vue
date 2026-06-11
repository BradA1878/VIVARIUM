<script setup lang="ts">
/* The campaign's last frame (doc §2.5). On victory the colony has reached
   self-sufficiency before the launch window closed; on defeat the window shut on
   an unfinished colony, or the last colonist died. The Chronicler has already
   spoken; this is the record on the screen — the epitaph, the run's telemetry
   curves, the event ledger, the planet's cross-run dossier, and the terms of the
   next attempt. */
import { computed } from "vue";
import type { Difficulty, EventType, HazardKind } from "@shared/types";
import { useColony } from "@/ui/stores/colony";
import { useSettings } from "@/ui/stores/settings";
import { RES } from "@/ui/resources";
import Sparkline from "./Sparkline.vue";

const { snapshot, controls, runHistory, runEpitaph, directorDossier } = useColony();
const { settings, updateSettings } = useSettings();

const s = computed(() => snapshot.value);
const won = computed(() => s.value?.outcome === "victory");

const headline = computed(() => (won.value ? "SELF-SUFFICIENT" : "THE COLONY IS LOST"));
const subline = computed(() => {
  if (!s.value) return "";
  if (won.value) return "It needs Earth no longer. The watch holds.";
  return s.value.outcomeReason === "window"
    ? "The launch window closed before the colony could stand on its own."
    : "The last of them stopped breathing. Only the record remains.";
});

// the run report reads once the outcome is set; the store keeps recording until then
const hist = computed(() => (s.value?.outcome ? runHistory() : null));
const epitaph = computed(() => (s.value?.outcome ? runEpitaph() : ""));
const dossier = computed(() => (s.value?.outcome ? directorDossier() : null));

// ---- telemetry curves ---------------------------------------------------------
const RES_COL = Object.fromEntries(RES.map((r) => [r.k, r.col])) as Record<string, string>;
const charts = computed(() => {
  const h = hist.value;
  if (!h || h.samples.length < 2) return [];
  return [
    { label: "POWER", color: RES_COL.power, values: h.samples.map((p) => p.power) },
    { label: "WATER", color: RES_COL.water, values: h.samples.map((p) => p.water) },
    { label: "OXYGEN", color: RES_COL.oxygen, values: h.samples.map((p) => p.oxygen) },
    { label: "FOOD", color: RES_COL.food, values: h.samples.map((p) => p.food) },
    { label: "POPULATION", color: "#d6e2e6", values: h.samples.map((p) => p.pop) },
  ];
});

// ---- the event ledger -----------------------------------------------------------
const EVENT_LABEL: Partial<Record<EventType, [string, string]>> = {
  brownout: ["brownout", "brownouts"],
  casualty: ["casualty", "casualties"],
  abducted: ["abduction", "abductions"],
  birth: ["birth", "births"],
  building_destroyed: ["building lost", "buildings lost"],
  trade_done: ["trade", "trades"],
  resupply: ["resupply", "resupplies"],
  arrival: ["arrival", "arrivals"],
};
const tally = computed(() => {
  const h = hist.value;
  if (!h) return [];
  const chips: string[] = [];
  const hz = (Object.entries(h.hazards) as [HazardKind, number][]).sort((a, b) => b[1] - a[1]);
  for (const [kind, n] of hz) chips.push(`${n} ${kind}`);
  for (const [type, [one, many]] of Object.entries(EVENT_LABEL) as [EventType, [string, string]][]) {
    const n = h.events[type] ?? 0;
    if (n > 0) chips.push(`${n} ${n === 1 ? one : many}`);
  }
  if (h.directorStrikes > 0) chips.push(`${h.directorStrikes} director strike${h.directorStrikes === 1 ? "" : "s"}`);
  return chips;
});

// ---- the dossier ------------------------------------------------------------------
function rows<K extends string>(rec: Record<K, number>): { k: K; n: number; pct: number }[] {
  const entries = Object.entries(rec) as [K, number][];
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return entries.map(([k, n]) => ({ k, n, pct: Math.round((n / max) * 100) }));
}
const axisRows = computed(() => (dossier.value ? rows(dossier.value.byAxis) : []));
const hazardRows = computed(() => (dossier.value ? rows(dossier.value.byHazard) : []));
const avgSols = computed(() => (dossier.value ? Math.round(dossier.value.avgSols * 10) / 10 : 0));
const biasLine = computed(() => {
  const d = dossier.value;
  if (!d) return "";
  const ups = (Object.entries(d.bias) as [HazardKind, number][])
    .map(([k, v]) => [k, Math.round((v - 1) * 100)] as const)
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1]);
  if (ups.length === 0) return "opening pressure: neutral";
  return "opening pressure: " + ups.map(([k, p]) => `${k} +${p}%`).join(" · ");
});

// ---- next run -------------------------------------------------------------------
const DIFFS: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "CALM" },
  { value: "normal", label: "STANDARD" },
  { value: "hard", label: "BRUTAL" },
];

/** the difficulty THIS run was played at (the NEXT RUN selector below is separate) */
const runDiff = computed(
  () => DIFFS.find((d) => d.value === s.value?.difficulty)?.label ?? "STANDARD",
);
</script>

<template>
  <div v-if="s && s.outcome" class="endscreen" :class="won ? 'win' : 'lose'">
    <div class="end-inner">
      <div class="end-mark">{{ headline }}</div>
      <div class="end-sub">{{ subline }}</div>
      <div v-if="epitaph" class="end-epitaph">{{ epitaph }}</div>
      <div class="end-stats">
        <span class="end-chip run-diff">{{ runDiff }}</span>
        <span class="sep">·</span>
        <span><b>{{ s.sol }}</b> {{ s.sol === 1 ? "sol" : "sols" }}</span>
        <span class="sep">·</span>
        <span><b>{{ s.population }}</b> survived</span>
        <span class="sep">·</span>
        <span :class="{ lost: s.dead > 0 }"><b>{{ s.dead }}</b> lost</span>
      </div>

      <div v-if="charts.length" class="end-sec">
        <div class="end-sec-title">RUN TELEMETRY</div>
        <div class="end-charts">
          <Sparkline v-for="c in charts" :key="c.label" :values="c.values" :color="c.color" :label="c.label" />
        </div>
      </div>

      <div v-if="tally.length" class="end-chips">
        <span v-for="chip in tally" :key="chip" class="end-chip">{{ chip }}</span>
      </div>

      <div v-if="dossier && dossier.runs >= 1" class="end-sec dossier">
        <div class="end-sec-title">WHAT THE PLANET HAS LEARNED</div>
        <div class="dos-head">
          <b>{{ dossier.runs }}</b> {{ dossier.runs === 1 ? "run" : "runs" }}
          <span class="sep">·</span> <b>{{ dossier.wins }}</b> won
          <span class="sep">·</span> <b>{{ dossier.deaths }}</b> lost
          <span class="sep">·</span> avg <b>{{ avgSols }}</b> sols
        </div>
        <div class="dos-cols">
          <div class="dos-col">
            <div class="dos-sub">DEATHS BY RESOURCE</div>
            <div v-for="row in axisRows" :key="row.k" class="dos-row">
              <span class="dos-k">{{ row.k }}</span>
              <span class="dos-bar"><span class="dos-fill axis" :style="{ width: row.pct + '%' }" /></span>
              <span class="dos-n">{{ row.n }}</span>
            </div>
          </div>
          <div class="dos-col">
            <div class="dos-sub">DEATHS BY HAZARD</div>
            <div v-for="row in hazardRows" :key="row.k" class="dos-row">
              <span class="dos-k">{{ row.k }}</span>
              <span class="dos-bar"><span class="dos-fill hazard" :style="{ width: row.pct + '%' }" /></span>
              <span class="dos-n">{{ row.n }}</span>
            </div>
          </div>
        </div>
        <div class="dos-bias">{{ biasLine }}</div>
      </div>

      <div class="end-next">
        <span class="end-next-label">NEXT RUN</span>
        <button
          v-for="d in DIFFS"
          :key="d.value"
          class="end-diff"
          :class="{ on: settings.nextDifficulty === d.value }"
          @click="updateSettings({ nextDifficulty: d.value })"
        >
          {{ d.label }}
        </button>
      </div>
      <button class="end-btn" @click="controls.reset()">BEGIN AGAIN</button>
    </div>
  </div>
</template>

<style scoped>
/* the report outgrew the old card — keep it centered but let it scroll */
.end-inner {
  max-width: 720px;
  width: min(720px, 94vw);
  max-height: 86vh;
  overflow-y: auto;
  padding: 10px 28px 26px;
}
.end-inner::-webkit-scrollbar { width: 5px; }
.end-inner::-webkit-scrollbar-thumb { background: var(--hair); border-radius: 3px; }

.end-epitaph {
  font-family: var(--serif);
  font-style: italic;
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--cyan);
  opacity: 0.9;
  margin: -12px 0 24px;
}

.end-sec { border-top: 1px solid var(--hair2); padding-top: 14px; margin: 18px 0; }
.end-sec-title { font-family: var(--mono); font-size: 9px; letter-spacing: 0.28em; color: var(--dim); margin-bottom: 12px; }

.end-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 14px 18px;
  justify-items: center;
}

/* the run's own difficulty, leading the headline stats — same chip recipe, with
   the cyan accent the difficulty selector already uses for "this one" */
.end-stats .run-diff { align-self: center; color: var(--cyan); border-color: rgba(127, 212, 232, 0.5); background: rgba(127, 212, 232, 0.1); }

.end-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin: 14px 0 4px; }
.end-chip {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--ink);
  padding: 3px 9px;
  border: 1px solid var(--hair);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.02);
  white-space: nowrap;
}

.dossier { text-align: left; }
.dos-head {
  font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; color: var(--ink);
  margin-bottom: 12px;
}
.dos-head b { color: #e6eef1; font-weight: 500; }
.dos-head .sep { color: var(--faint); margin: 0 4px; }
.dos-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 26px; }
.dos-sub { font-family: var(--mono); font-size: 8.5px; letter-spacing: 0.22em; color: var(--faint); margin-bottom: 7px; }
.dos-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
.dos-k { font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em; color: var(--dim); width: 64px; flex: 0 0 auto; }
.dos-bar { flex: 1; height: 4px; background: rgba(255, 255, 255, 0.05); border-radius: 2px; overflow: hidden; }
.dos-fill { display: block; height: 100%; border-radius: 2px; transition: width 0.3s ease; }
.dos-fill.axis { background: var(--cyan); box-shadow: 0 0 6px rgba(127, 212, 232, 0.4); }
.dos-fill.hazard { background: var(--rust); box-shadow: 0 0 6px rgba(200, 121, 79, 0.4); }
.dos-n { font-family: var(--mono); font-size: 10px; color: var(--ink); width: 18px; text-align: right; font-variant-numeric: tabular-nums; }
.dos-bias {
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.08em; color: var(--rust);
  margin-top: 12px;
}

.end-next { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 4px 0 14px; }
.end-next-label { font-family: var(--mono); font-size: 9px; letter-spacing: 0.24em; color: var(--dim); margin-right: 6px; }
.end-diff {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--dim);
  padding: 4px 10px;
  border: 1px solid var(--hair);
  border-radius: 3px;
  transition: 0.14s;
}
.end-diff:hover { color: var(--ink); border-color: rgba(127, 212, 232, 0.4); }
.end-diff.on { color: var(--cyan); border-color: rgba(127, 212, 232, 0.5); background: rgba(127, 212, 232, 0.1); }

@media (max-width: 880px) {
  .end-charts { grid-template-columns: 1fr; }
  .dos-cols { grid-template-columns: 1fr; }
}
</style>
