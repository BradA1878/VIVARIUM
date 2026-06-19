<script setup lang="ts">
/* ============================================================================
   ColoniesMap — the in-game switcher + inter-planet logistics (parallel-colonies).
   A toggle tab opens a panel listing every settled world from the Colonies ledger;
   clicking a row's name switches the live colony to it (the store saves the leaving
   colony, then loads + deterministically catches up + resumes the target —
   controls.switchTo). The live colony is highlighted.

   Each AWAY row also carries a "⤳ ship" affordance that opens a small row-level
   composer (materials / water / crew steppers, each clamped to what the LIVE colony
   currently holds); SEND debits the live colony and queues the shipment for that
   world (controls.dispatchShipment). A transit section lists everything in flight
   with a rough ETA. The HUD only observes the ledger + snapshot.
   ============================================================================ */
import { computed, reactive, ref } from "vue";
import type { Resource, ShipmentManifest, World } from "@shared/types";
import type { Shipment } from "@/persistence/colonies";
import { SOL_LENGTH } from "@/engine/tuning";
import { useColony } from "../stores/colony";
import { WORLD_META } from "../founding";
import { audio } from "../audio";

const { snapshot, colonies, shipments, activeSlot, controls } = useColony();

const open = ref(false);

// the ledger isn't a reactive source — touch the snapshot so the list (and the
// in-transit queue + the live availability the composer clamps to) refreshes each tick.
const list = computed(() => { void snapshot.value; return colonies(); });
const inTransit = computed(() => { void snapshot.value; return shipments(); });

const worldLabel = (id: string): string => WORLD_META[id as World]?.label ?? id;
const statusOf = (slotKey: string, outcome: string | null): string =>
  slotKey === activeSlot.value ? "here"
    : outcome === "defeat" ? "lost"
    : outcome === "victory" ? "settled"
    : "away";

// ---- live availability the composer steppers clamp to ------------------------
const haveMaterials = computed(() => Math.floor(snapshot.value?.materials.amount ?? 0));
const haveWater = computed(() => Math.floor(snapshot.value?.pools.water.amount ?? 0));
// keep the last colonist home — you can't ship the whole crew
const haveCrew = computed(() => Math.max(0, (snapshot.value?.population ?? 0) - 1));

// ---- the row-level shipment composer ----------------------------------------
type Draft = { materials: number; water: number; crew: number };
const composing = ref<string | null>(null); // the slotKey whose composer is open
const draft = reactive<Draft>({ materials: 0, water: 0, crew: 0 });

const capOf: Record<keyof Draft, () => number> = {
  materials: () => haveMaterials.value,
  water: () => haveWater.value,
  crew: () => haveCrew.value,
};

function openComposer(slotKey: string): void {
  audio.uiTick();
  composing.value = composing.value === slotKey ? null : slotKey;
  draft.materials = 0; draft.water = 0; draft.crew = 0;
}
function closeComposer(): void { composing.value = null; }

function clampDraft(): void {
  // re-clamp in case the live colony spent something while the composer was open
  draft.materials = clamp(draft.materials, capOf.materials());
  draft.water = clamp(draft.water, capOf.water());
  draft.crew = clamp(draft.crew, capOf.crew());
}
function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(Math.round(n || 0), Math.max(0, max)));
}
function step(field: keyof Draft, by: number): void {
  audio.uiTick();
  draft[field] = clamp(draft[field] + by, capOf[field]());
}
function onInput(field: keyof Draft, ev: Event): void {
  draft[field] = clamp(Number((ev.target as HTMLInputElement).value), capOf[field]());
}

const draftEmpty = computed(() => draft.materials <= 0 && draft.water <= 0 && draft.crew <= 0);
const canSend = computed(() =>
  !!composing.value && composing.value !== activeSlot.value && !draftEmpty.value,
);

function send(slotKey: string): void {
  clampDraft();
  if (slotKey === activeSlot.value || draftEmpty.value) return;
  const manifest: ShipmentManifest = {};
  const resources: Partial<Record<Resource, number>> = {};
  if (draft.water > 0) resources.water = draft.water;
  if (Object.keys(resources).length) manifest.resources = resources;
  if (draft.materials > 0) manifest.materials = draft.materials;
  if (draft.crew > 0) manifest.crew = draft.crew;
  audio.uiTick();
  controls.dispatchShipment(slotKey, manifest);
  closeComposer();
}

// ---- in-transit display ------------------------------------------------------
/** rough whole-sols of transit left; "arriving" once the timer is up */
function etaLabel(s: Shipment): string {
  const remainingMs = s.dispatchedAt + s.transitSols * SOL_LENGTH * 1000 - Date.now();
  if (remainingMs <= 0) return "arriving";
  const sols = Math.max(1, Math.ceil(remainingMs / (SOL_LENGTH * 1000)));
  return `ETA ~${sols} ${sols === 1 ? "sol" : "sols"}`;
}
/** "12 mat · 8 water · 1 crew" — only the carried fields */
function manifestSummary(m: ShipmentManifest): string {
  const parts: string[] = [];
  if (m.materials) parts.push(`${m.materials} mat`);
  for (const [res, amt] of Object.entries(m.resources ?? {})) {
    if (amt) parts.push(`${amt} ${res}`);
  }
  if (m.crew) parts.push(`${m.crew} crew`);
  return parts.length ? parts.join(" · ") : "empty";
}
const destLabel = (slotKey: string): string =>
  worldLabel(list.value.find((c) => c.slotKey === slotKey)?.worldId ?? slotKey);

function go(slotKey: string): void {
  audio.uiTick();
  open.value = false;
  if (slotKey !== activeSlot.value) void controls.switchTo(slotKey);
}
function toggle(): void {
  audio.uiTick();
  open.value = !open.value;
  if (!open.value) closeComposer();
}
</script>

<template>
  <button class="colonies-toggle" :class="{ on: open }" @click="toggle">&#8862; COLONIES</button>

  <div v-if="open" class="colonies-panel">
    <div class="colonies-title">COLONIES</div>

    <div
      v-for="c in list"
      :key="c.slotKey"
      class="colony-row"
      :class="{ active: c.slotKey === activeSlot, lost: c.outcome === 'defeat' }"
    >
      <div class="cr-head">
        <button
          class="cr-name"
          :disabled="c.slotKey === activeSlot"
          :title="c.slotKey === activeSlot ? 'live colony' : 'switch to this colony'"
          @click="go(c.slotKey)"
        >
          <span class="cr-world">{{ worldLabel(c.worldId) }}</span>
          <span class="cr-meta">{{ c.sols }} {{ c.sols === 1 ? "sol" : "sols" }} · {{ c.population }} souls · {{ statusOf(c.slotKey, c.outcome) }}</span>
        </button>
        <button
          v-if="c.slotKey !== activeSlot"
          class="cr-ship"
          :class="{ on: composing === c.slotKey }"
          title="send a shipment to this colony"
          @click="openComposer(c.slotKey)"
        >&#10547; ship</button>
      </div>

      <div v-if="composing === c.slotKey" class="composer">
        <div class="comp-row">
          <span class="comp-lbl">materials</span>
          <div class="comp-step">
            <button class="step-btn" :disabled="draft.materials <= 0" @click="step('materials', -1)">&minus;</button>
            <input class="step-in" type="number" min="0" :max="haveMaterials" :value="draft.materials" @input="onInput('materials', $event)" />
            <button class="step-btn" :disabled="draft.materials >= haveMaterials" @click="step('materials', 1)">+</button>
          </div>
          <span class="comp-cap">/ {{ haveMaterials }}</span>
        </div>
        <div class="comp-row">
          <span class="comp-lbl">water</span>
          <div class="comp-step">
            <button class="step-btn" :disabled="draft.water <= 0" @click="step('water', -1)">&minus;</button>
            <input class="step-in" type="number" min="0" :max="haveWater" :value="draft.water" @input="onInput('water', $event)" />
            <button class="step-btn" :disabled="draft.water >= haveWater" @click="step('water', 1)">+</button>
          </div>
          <span class="comp-cap">/ {{ haveWater }}</span>
        </div>
        <div class="comp-row">
          <span class="comp-lbl">crew</span>
          <div class="comp-step">
            <button class="step-btn" :disabled="draft.crew <= 0" @click="step('crew', -1)">&minus;</button>
            <input class="step-in" type="number" min="0" :max="haveCrew" :value="draft.crew" @input="onInput('crew', $event)" />
            <button class="step-btn" :disabled="draft.crew >= haveCrew" @click="step('crew', 1)">+</button>
          </div>
          <span class="comp-cap">/ {{ haveCrew }}</span>
        </div>
        <button class="comp-send" :disabled="!canSend" @click="send(c.slotKey)">&#10547; SEND</button>
      </div>
    </div>

    <div v-if="!list.length" class="colonies-empty">No colonies yet — launch a Transport Pod to found one.</div>

    <div v-if="inTransit.length" class="transit">
      <div class="transit-title">IN TRANSIT</div>
      <div v-for="s in inTransit" :key="s.id" class="transit-row">
        <span class="tr-dest">&rarr; {{ destLabel(s.toSlot) }}</span>
        <span class="tr-manifest">{{ manifestSummary(s.manifest) }}</span>
        <span class="tr-eta" :class="{ arriving: etaLabel(s) === 'arriving' }">{{ etaLabel(s) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.colonies-toggle {
  pointer-events: auto;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: #c7a6f2;
  padding: 6px 11px;
  border: 1px solid rgba(176, 130, 232, 0.4);
  border-radius: 4px;
  background: var(--panel);
  backdrop-filter: blur(10px);
  transition: 0.14s;
}
.colonies-toggle:hover, .colonies-toggle.on {
  background: rgba(176, 130, 232, 0.16);
  border-color: rgba(176, 130, 232, 0.7);
}

.colonies-panel {
  pointer-events: auto;
  margin-top: 8px;
  width: 250px;
  max-width: 100%;
  background: var(--panel);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(176, 130, 232, 0.3);
  border-radius: 4px;
  padding: 11px 11px 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
}
.colonies-title {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.28em;
  color: var(--dim);
  margin-bottom: 10px;
}
.colony-row {
  width: 100%;
  margin-bottom: 5px;
  border-radius: 3px;
  border: 1px solid var(--hair2);
  background: rgba(255, 255, 255, 0.02);
  transition: 0.13s;
}
.colony-row.active { border-color: rgba(127, 212, 232, 0.55); background: rgba(127, 212, 232, 0.08); }
.colony-row.lost { opacity: 0.6; }

.cr-head { display: flex; align-items: stretch; gap: 4px; }
.cr-name {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
  padding: 7px 9px;
  border-radius: 3px;
  background: transparent;
  transition: 0.13s;
  cursor: pointer;
}
.cr-name:hover:not(:disabled) { background: rgba(176, 130, 232, 0.14); }
.cr-name:disabled { cursor: default; }
.cr-world { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; color: #e6eef1; }
.colony-row.active .cr-world { color: var(--cyan); }
.cr-meta { font-family: var(--mono); font-size: 9px; letter-spacing: 0.04em; color: var(--dim); }

.cr-ship {
  align-self: center;
  flex: 0 0 auto;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: #9bd6a0;
  padding: 5px 8px;
  margin-right: 5px;
  border: 1px solid rgba(155, 214, 160, 0.32);
  border-radius: 3px;
  background: rgba(155, 214, 160, 0.06);
  transition: 0.13s;
  white-space: nowrap;
}
.cr-ship:hover, .cr-ship.on {
  background: rgba(155, 214, 160, 0.18);
  border-color: rgba(155, 214, 160, 0.6);
}

/* row-level shipment composer */
.composer {
  padding: 7px 9px 8px;
  border-top: 1px solid var(--hair2);
}
.comp-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 5px;
}
.comp-lbl {
  flex: 0 0 56px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--dim);
}
.comp-step {
  display: flex;
  align-items: center;
  gap: 3px;
}
.step-btn {
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1;
  width: 18px;
  height: 18px;
  color: #c7a6f2;
  border: 1px solid var(--hair2);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.02);
  transition: 0.12s;
}
.step-btn:hover:not(:disabled) { background: rgba(176, 130, 232, 0.18); border-color: rgba(176, 130, 232, 0.5); }
.step-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.step-in {
  width: 42px;
  font-family: var(--mono);
  font-size: 10px;
  text-align: center;
  color: #e6eef1;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--hair2);
  border-radius: 3px;
  padding: 3px 2px;
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
  appearance: textfield;
}
.step-in::-webkit-outer-spin-button,
.step-in::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.comp-cap {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}
.comp-send {
  width: 100%;
  margin-top: 3px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  padding: 6px 0;
  color: #9bd6a0;
  border: 1px solid rgba(155, 214, 160, 0.45);
  border-radius: 3px;
  background: rgba(155, 214, 160, 0.08);
  transition: 0.13s;
}
.comp-send:hover:not(:disabled) { background: rgba(155, 214, 160, 0.18); }
.comp-send:disabled {
  color: var(--faint);
  border-color: var(--hair2);
  background: transparent;
  cursor: not-allowed;
}

.colonies-empty { font-family: var(--mono); font-size: 9.5px; line-height: 1.4; color: var(--faint); padding: 4px 2px; }

/* in-transit section */
.transit {
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px solid var(--hair2);
}
.transit-title {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.28em;
  color: var(--dim);
  margin-bottom: 7px;
}
.transit-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.03em;
  margin-bottom: 4px;
}
.tr-dest { flex: 0 0 auto; color: #c7a6f2; letter-spacing: 0.08em; }
.tr-manifest { flex: 1; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tr-eta { flex: 0 0 auto; color: var(--faint); font-variant-numeric: tabular-nums; }
.tr-eta.arriving { color: #9bd6a0; }
</style>
