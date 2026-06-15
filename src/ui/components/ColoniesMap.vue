<script setup lang="ts">
/* ============================================================================
   ColoniesMap — the in-game switcher (parallel-colonies). A toggle tab opens a
   panel listing every settled world from the Colonies ledger; clicking one
   switches the live colony to it (the store saves the leaving colony, then loads
   + deterministically catches up + resumes the target — controls.switchTo). The
   live colony is highlighted. The HUD only observes the ledger + snapshot.
   ============================================================================ */
import { computed, ref } from "vue";
import type { World } from "@shared/types";
import { useColony } from "../stores/colony";
import { WORLD_META } from "../founding";
import { audio } from "../audio";

const { snapshot, colonies, activeSlot, controls } = useColony();

const open = ref(false);

// the ledger isn't a reactive source — touch the snapshot so the list refreshes as
// the live colony's row (sols/population) updates each tick.
const list = computed(() => { void snapshot.value; return colonies(); });

const worldLabel = (id: string): string => WORLD_META[id as World]?.label ?? id;
const statusOf = (slotKey: string, outcome: string | null): string =>
  slotKey === activeSlot.value ? "here"
    : outcome === "defeat" ? "lost"
    : outcome === "victory" ? "settled"
    : "away";

function go(slotKey: string): void {
  audio.uiTick();
  open.value = false;
  if (slotKey !== activeSlot.value) void controls.switchTo(slotKey);
}
function toggle(): void { audio.uiTick(); open.value = !open.value; }
</script>

<template>
  <button class="colonies-toggle" :class="{ on: open }" @click="toggle">&#8862; COLONIES</button>

  <div v-if="open" class="colonies-panel">
    <div class="colonies-title">COLONIES</div>
    <button
      v-for="c in list"
      :key="c.slotKey"
      class="colony-row"
      :class="{ active: c.slotKey === activeSlot, lost: c.outcome === 'defeat' }"
      :disabled="c.slotKey === activeSlot"
      @click="go(c.slotKey)"
    >
      <span class="cr-world">{{ worldLabel(c.worldId) }}</span>
      <span class="cr-meta">{{ c.sols }} {{ c.sols === 1 ? "sol" : "sols" }} · {{ c.population }} souls · {{ statusOf(c.slotKey, c.outcome) }}</span>
    </button>
    <div v-if="!list.length" class="colonies-empty">No colonies yet — launch a Transport Pod to found one.</div>
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
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 7px 9px;
  margin-bottom: 5px;
  border-radius: 3px;
  border: 1px solid var(--hair2);
  background: rgba(255, 255, 255, 0.02);
  transition: 0.13s;
  cursor: pointer;
}
.colony-row:hover:not(:disabled) { background: rgba(176, 130, 232, 0.14); border-color: rgba(176, 130, 232, 0.5); }
.colony-row.active { border-color: rgba(127, 212, 232, 0.55); background: rgba(127, 212, 232, 0.08); cursor: default; }
.colony-row.lost { opacity: 0.6; }
.cr-world { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; color: #e6eef1; }
.colony-row.active .cr-world { color: var(--cyan); }
.cr-meta { font-family: var(--mono); font-size: 9px; letter-spacing: 0.04em; color: var(--dim); }
.colonies-empty { font-family: var(--mono); font-size: 9.5px; line-height: 1.4; color: var(--faint); padding: 4px 2px; }
</style>
