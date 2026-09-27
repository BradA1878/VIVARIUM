<script setup lang="ts">
/* The selected building's card, in the right column: what the building is for,
   what it makes, uses, and needs (from its def), whether it is working now and
   why not, and its crew setting. Opens only for a player who can build. */
import { computed } from "vue";
import type { BuildingMode } from "@shared/types";
import { DEFS, modesFor } from "@/engine";
import { worldProfile } from "@/engine/tuning";
import { useColony } from "@/ui/stores/colony";
import { buildingFacts, statusLabel, statusLine } from "@/ui/buildingFacts";

const { snapshot, selected, capabilities, controls } = useColony();

const building = computed(() => {
  const sel = selected.value;
  const snap = snapshot.value;
  if (!sel || !snap || !capabilities.value.canBuild) return null;
  return snap.buildings.find((b) => b.uid === sel.uid) ?? null;
});
const def = computed(() => (building.value ? DEFS[building.value.defId] ?? null : null));
const facts = computed(() => (def.value ? buildingFacts(def.value, worldProfile(snapshot.value?.world).solar) : null));
const label = computed(() => (building.value ? statusLabel(building.value) : null));
const now = computed(() => (building.value && snapshot.value ? statusLine(building.value, snapshot.value) : null));
const off = computed(() => !!building.value?.offReason);

const modes = computed(() => (def.value ? modesFor(def.value) : []));
const crewed = computed(() => modes.value.includes("first"));
const current = computed<BuildingMode>(() => building.value?.mode ?? "normal");
/** FIRST / NORMAL / OFF for a crewed building, ON / OFF for another power user */
const buttons = computed<{ mode: BuildingMode; label: string }[]>(() => {
  if (crewed.value) return [{ mode: "first", label: "FIRST" }, { mode: "normal", label: "NORMAL" }, { mode: "off", label: "OFF" }];
  if (modes.value.length) return [{ mode: "normal", label: "ON" }, { mode: "off", label: "OFF" }];
  return [];
});

function choose(mode: BuildingMode): void {
  if (building.value) controls.setMode(building.value.uid, mode);
}
</script>

<template>
  <section v-if="building && def && facts" class="building-card" :aria-label="`${def.name} details`">
    <header class="bc-head">
      <span class="bc-name">{{ def.name.toUpperCase() }}</span>
      <span v-if="label" class="bc-status" :class="{ off }">{{ label }}</span>
    </header>
    <p class="bc-desc">{{ def.desc }}</p>
    <dl class="bc-facts">
      <template v-if="facts.makes.length"><dt>makes</dt><dd>{{ facts.makes.join(", ") }}</dd></template>
      <template v-if="facts.uses.length"><dt>uses</dt><dd>{{ facts.uses.join(", ") }}</dd></template>
      <template v-if="facts.needs.length"><dt>needs</dt><dd>{{ facts.needs.join(" · ") }}</dd></template>
      <template v-if="now"><dt>now</dt><dd :class="{ off }">{{ now }}</dd></template>
    </dl>
    <div v-if="buttons.length" class="bc-modes" role="group" :aria-label="crewed ? 'Crew setting' : 'Power switch'">
      <button
        v-for="b in buttons"
        :key="b.mode"
        type="button"
        class="bc-mode"
        :aria-pressed="current === b.mode"
        @click="choose(b.mode)"
      >
        {{ b.label }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.building-card {
  width: 100%;
  pointer-events: auto;
  background: var(--panel);
  backdrop-filter: blur(9px);
  border: 1px solid var(--hair);
  border-radius: 3px;
  padding: 10px 12px;
  font-size: 11px;
}
.bc-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; letter-spacing: 0.1em; }
.bc-name { color: var(--ink); font-weight: 500; }
.bc-status { color: var(--cyan); font-size: 10px; white-space: nowrap; }
.bc-status.off { color: var(--rust); }
.bc-desc { color: var(--dim); font-size: 10px; line-height: 1.45; margin: 6px 0 8px; }
.bc-facts { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; font-size: 10px; }
.bc-facts dt { color: var(--faint); letter-spacing: 0.08em; }
.bc-facts dd { margin: 0; color: var(--ink); }
.bc-facts dd.off { color: var(--rust); }
.bc-modes { display: flex; gap: 6px; margin-top: 10px; }
.bc-mode {
  flex: 1;
  padding: 5px 0;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--dim);
  border: 1px solid var(--hair2);
  border-radius: 3px;
  transition: 0.13s;
}
.bc-mode:hover { color: var(--ink); }
.bc-mode[aria-pressed="true"] { color: var(--cyan); border-color: rgba(127, 212, 232, 0.5); background: rgba(127, 212, 232, 0.08); }
</style>
