<script setup lang="ts">
/* ============================================================================
   Lobby — the co-op multiplayer entry (Phase 2). A toggle opens a small panel to
   HOST a colony (open a serverless Trystero room, play as the architect) or JOIN
   one by code (become an astronaut on the host's world). Once connected it shows
   the live roster. The session lifecycle (room + relay/netbridge) lives in App.vue,
   which owns the renderer/bridge; this panel just collects a callsign + code and
   emits — the HUD observes, it never reaches across the wall.
   ============================================================================ */
import { ref } from "vue";
import { useColony } from "../stores/colony";
import { audio } from "../audio";

const { mode, roster } = useColony();
const emit = defineEmits<{
  host: [payload: { code: string; name: string }];
  join: [payload: { code: string; name: string }];
}>();

const open = ref(false);
const name = ref("");
const code = ref("");

function toggle(): void { audio.uiTick(); open.value = !open.value; }
function host(): void {
  if (!code.value.trim()) return;
  audio.uiTick();
  emit("host", { code: code.value.trim(), name: name.value.trim() || "Architect" });
}
function join(): void {
  if (!code.value.trim()) return;
  audio.uiTick();
  emit("join", { code: code.value.trim(), name: name.value.trim() || "Astronaut" });
}
const roleLabel = (actorId: number | null): string => (actorId == null ? "spectating" : `cmdr #${actorId}`);
</script>

<template>
  <button class="coop-toggle" :class="{ on: open, live: mode !== 'solo' }" @click="toggle">&#9678; CO-OP</button>

  <div v-if="open" class="coop-panel">
    <div class="coop-title">CO-OP · {{ mode === "solo" ? "OFFLINE" : mode === "host" ? "HOSTING" : "GUEST" }}</div>

    <template v-if="mode === 'solo'">
      <label class="coop-field">
        <span class="cf-lbl">callsign</span>
        <input class="cf-in" v-model="name" maxlength="16" placeholder="your name" />
      </label>
      <label class="coop-field">
        <span class="cf-lbl">room code</span>
        <input class="cf-in" v-model="code" maxlength="24" placeholder="e.g. marsbase" @keyup.enter="host" />
      </label>
      <div class="coop-actions">
        <button class="coop-btn host" :disabled="!code.trim()" @click="host">&#9632; HOST</button>
        <button class="coop-btn join" :disabled="!code.trim()" @click="join">&rarr; JOIN</button>
      </div>
      <div class="coop-hint">The host runs the colony and builds; guests each drive an astronaut. Share the code out-of-band.</div>
    </template>

    <template v-else>
      <div class="coop-you">You are the <strong>{{ mode === "host" ? "architect" : "astronaut" }}</strong>.</div>
      <div class="roster">
        <div v-for="p in roster" :key="p.peerId" class="roster-row">
          <span class="rr-name">{{ p.name }}</span>
          <span class="rr-role">{{ roleLabel(p.actorId) }}</span>
        </div>
        <div v-if="!roster.length" class="roster-empty">Waiting for players to join&hellip;</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.coop-toggle {
  pointer-events: auto;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: #8fb8ff;
  padding: 6px 11px;
  border: 1px solid rgba(143, 184, 255, 0.4);
  border-radius: 4px;
  background: var(--panel);
  backdrop-filter: blur(10px);
  transition: 0.14s;
}
.coop-toggle:hover, .coop-toggle.on { background: rgba(143, 184, 255, 0.16); border-color: rgba(143, 184, 255, 0.7); }
.coop-toggle.live { color: #9bd6a0; border-color: rgba(155, 214, 160, 0.6); }

.coop-panel {
  pointer-events: auto;
  margin-top: 8px;
  width: 250px;
  max-width: 100%;
  background: var(--panel);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(143, 184, 255, 0.3);
  border-radius: 4px;
  padding: 11px 11px 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
}
.coop-title {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.24em;
  color: var(--dim);
  margin-bottom: 10px;
}

.coop-field { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.cf-lbl {
  flex: 0 0 58px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--dim);
}
.cf-in {
  flex: 1;
  font-family: var(--mono);
  font-size: 10px;
  color: #e6eef1;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--hair2);
  border-radius: 3px;
  padding: 5px 7px;
}
.cf-in:focus { outline: none; border-color: rgba(143, 184, 255, 0.6); }

.coop-actions { display: flex; gap: 6px; margin-top: 3px; }
.coop-btn {
  flex: 1;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  padding: 7px 0;
  border-radius: 3px;
  transition: 0.13s;
}
.coop-btn.host { color: #8fb8ff; border: 1px solid rgba(143, 184, 255, 0.45); background: rgba(143, 184, 255, 0.08); }
.coop-btn.host:hover:not(:disabled) { background: rgba(143, 184, 255, 0.18); }
.coop-btn.join { color: #9bd6a0; border: 1px solid rgba(155, 214, 160, 0.45); background: rgba(155, 214, 160, 0.08); }
.coop-btn.join:hover:not(:disabled) { background: rgba(155, 214, 160, 0.18); }
.coop-btn:disabled { color: var(--faint); border-color: var(--hair2); background: transparent; cursor: not-allowed; }

.coop-hint { font-family: var(--mono); font-size: 9px; line-height: 1.45; color: var(--faint); margin-top: 9px; }

.coop-you { font-family: var(--mono); font-size: 10px; color: #cfe0ee; margin-bottom: 9px; }
.coop-you strong { color: #9bd6a0; }
.roster { display: flex; flex-direction: column; gap: 4px; }
.roster-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 10px;
  padding: 4px 7px;
  border: 1px solid var(--hair2);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.02);
}
.rr-name { color: #e6eef1; letter-spacing: 0.04em; }
.rr-role { color: var(--dim); font-size: 9px; font-variant-numeric: tabular-nums; }
.roster-empty { font-family: var(--mono); font-size: 9.5px; color: var(--faint); padding: 4px 2px; }
</style>
