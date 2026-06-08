<script setup lang="ts">
/* ============================================================================
   TradePrompt — the alien trade overlay (right column, under Alerts). The HUD
   only observes the snapshot's `trade` view and issues a single respondTrade
   command. Inbound is a quiet notice; landed is the decision panel (offer +
   countdown + Accept/Decline); leaving is a brief lift-off note.
   ============================================================================ */
import { computed } from "vue";
import { useColony } from "../stores/colony";
import { fmt } from "../format";

const { snapshot, controls } = useColony();

const trade = computed(() => snapshot.value?.trade ?? null);

/** what the colony currently holds of the resource the traders want */
const have = computed(() => {
  const s = snapshot.value;
  const t = trade.value;
  if (!s || !t) return 0;
  return t.take.res === "materials"
    ? s.materials.amount
    : s.pools[t.take.res].amount;
});

const canAfford = computed(() => !!trade.value && have.value >= trade.value.take.amount);
</script>

<template>
  <div v-if="trade && trade.phase === 'inbound'" class="trade trade-note">
    <span class="trade-mark">&#9672;</span> TRADERS INBOUND
  </div>

  <div v-else-if="trade && trade.phase === 'landed'" class="trade trade-panel">
    <div class="trade-title">ALIEN TRADERS</div>
    <div class="trade-offer">
      <div class="trade-side give">
        <div class="trade-side-lbl">THEY GIVE</div>
        <div class="trade-side-val">{{ fmt(trade.give.amount) }} {{ trade.give.res }}</div>
      </div>
      <span class="trade-swap">&#8652;</span>
      <div class="trade-side take">
        <div class="trade-side-lbl">THEY TAKE</div>
        <div class="trade-side-val">{{ fmt(trade.take.amount) }} {{ trade.take.res }}</div>
      </div>
    </div>
    <div class="trade-countdown">offer closes in {{ fmt(Math.round(trade.deadline)) }}s</div>
    <div class="trade-actions">
      <button
        class="trade-btn accept"
        :disabled="!canAfford"
        @click="controls.respondTrade(true)"
      >
        Accept
      </button>
      <button class="trade-btn decline" @click="controls.respondTrade(false)">
        Decline
      </button>
    </div>
    <div v-if="!canAfford" class="trade-cant">
      can't afford &mdash; need {{ fmt(trade.take.amount) }} {{ trade.take.res }} ({{ fmt(have) }} on hand)
    </div>
  </div>

  <div v-else-if="trade && trade.phase === 'leaving'" class="trade trade-note">
    <span class="trade-mark">&#9672;</span> traders lifting off&hellip;
  </div>
</template>

<style scoped>
.trade {
  pointer-events: auto;
  font-family: var(--mono);
  margin-top: 8px;
}

/* quiet inbound / leaving notice */
.trade-note {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--cyan);
  background: var(--panel);
  backdrop-filter: blur(10px);
  border: 1px solid var(--hair);
  border-radius: 4px;
  padding: 8px 11px;
}
.trade-mark { color: var(--cyan); font-size: 11px; }

/* landed decision panel */
.trade-panel {
  width: 248px;
  background: var(--panel);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(127, 212, 232, 0.3);
  border-radius: 4px;
  padding: 12px 13px 11px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
}
.trade-title {
  font-size: 11px;
  letter-spacing: 0.22em;
  color: #e6eef1;
  margin-bottom: 10px;
}
.trade-offer {
  display: flex;
  align-items: stretch;
  gap: 8px;
  margin-bottom: 9px;
}
.trade-side {
  flex: 1;
  border: 1px solid var(--hair2);
  border-radius: 3px;
  padding: 6px 8px;
}
.trade-side-lbl {
  font-size: 8.5px;
  letter-spacing: 0.16em;
  color: var(--faint);
  margin-bottom: 3px;
}
.trade-side-val {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.trade-side.give .trade-side-val { color: #9bd6a0; }
.trade-side.take .trade-side-val { color: var(--rust); }
.trade-swap {
  align-self: center;
  color: var(--cyan);
  font-size: 14px;
}
.trade-countdown {
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--dim);
  font-variant-numeric: tabular-nums;
  margin-bottom: 10px;
}
.trade-actions { display: flex; gap: 7px; }
.trade-btn {
  flex: 1;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  padding: 7px 0;
  border-radius: 3px;
  border: 1px solid var(--hair);
  transition: 0.13s;
}
.trade-btn.accept {
  color: #9bd6a0;
  border-color: rgba(155, 214, 160, 0.45);
  background: rgba(155, 214, 160, 0.08);
}
.trade-btn.accept:hover:not(:disabled) { background: rgba(155, 214, 160, 0.16); }
.trade-btn.accept:disabled {
  color: var(--faint);
  border-color: var(--hair2);
  background: transparent;
  cursor: not-allowed;
}
.trade-btn.decline { color: var(--dim); }
.trade-btn.decline:hover { color: var(--ink); border-color: var(--hair); }
.trade-cant {
  margin-top: 8px;
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--crit);
}
</style>
