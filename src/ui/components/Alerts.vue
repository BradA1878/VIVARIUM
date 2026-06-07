<script setup lang="ts">
import { computed } from "vue";
import { useColony } from "@/ui/stores/colony";
import { fmt } from "@/ui/format";
import { DEFS } from "@/engine";

interface AlertItem {
  k: string;
  sev: 2 | 3;
  txt: string;
  sub: string;
}

const { snapshot } = useColony();
const s = computed(() => snapshot.value);

const items = computed<AlertItem[]>(() => {
  const cur = s.value;
  if (!cur) return [];
  const out: AlertItem[] = [];

  if (cur.weather === "dust") {
    out.push({
      k: "storm",
      sev: 2,
      txt: `DUST STORM — solar at ${fmt(cur.solarMul * 100)}%`,
      sub: `clears in ${fmt(cur.stormT)}s`,
    });
  }

  for (const r of ["oxygen", "water", "food"] as const) {
    const t = cur.timers[r];
    if (t != null) {
      out.push({
        k: r,
        sev: 3,
        txt: `${r.toUpperCase()} DEPLETED`,
        sub: `lethal in ${fmt(t)}s`,
      });
    }
  }

  const brown = cur.buildings.some((b) => {
    const def = DEFS[b.defId];
    return (
      def != null &&
      def.requiresPressure &&
      b.connected &&
      b.staffed &&
      b.fed &&
      !b.online &&
      (def.consumes.power ?? 0) > 0
    );
  });
  if (brown) {
    out.push({ k: "brown", sev: 2, txt: "BROWNOUT — load shed", sub: "demand exceeds supply" });
  }

  return out.sort((a, b) => b.sev - a.sev);
});
</script>

<template>
  <div v-if="s && items.length" class="alerts">
    <div v-for="it in items" :key="it.k" :class="'alert sev' + it.sev">
      <span class="alert-bar" />
      <div>
        <div class="alert-txt">{{ it.txt }}</div>
        <div class="alert-sub">{{ it.sub }}</div>
      </div>
    </div>
  </div>
</template>
