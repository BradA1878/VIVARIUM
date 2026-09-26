<script setup lang="ts">
import { computed } from "vue";
import { useColony } from "@/ui/stores/colony";
import { fmt } from "@/ui/format";
import type { HazardKind } from "@shared/types";
import { brownoutShed, faultAlerts, quakeAlertSub, resupplyAlertCopy } from "./alerts";

interface AlertItem {
  k: string;
  sev: 1 | 2 | 3;
  txt: string;
  sub: string;
  /** the buildings a fault line counts: the line is a button that shows the next one */
  uids?: number[];
}

const HAZARD: Record<HazardKind, { name: string; effect: string }> = {
  dust:     { name: "DUST STORM", effect: "guts the solar arrays" },
  meteor:   { name: "METEOR SHOWER", effect: "impacts — structures at risk" },
  flare:    { name: "SOLAR FLARE", effect: "siphons power · electronics faulting" },
  coldsnap: { name: "COLD SNAP", effect: "heating load climbing" },
  quake:    { name: "MARSQUAKE", effect: "the seal is shaking loose" },
};

const { snapshot, focusFault } = useColony();
const s = computed(() => snapshot.value);

const items = computed<AlertItem[]>(() => {
  const cur = s.value;
  if (!cur) return [];
  const out: AlertItem[] = [];

  // live hazards (telegraph + active) — the planet's repertoire
  for (const h of cur.hazards) {
    const meta = HAZARD[h.kind];
    const incoming = h.phase === "telegraph";
    out.push({
      k: "hz-" + h.kind,
      sev: incoming ? 3 : h.kind === "dust" || h.kind === "coldsnap" ? 2 : 3,
      txt: incoming ? `${meta.name} — INBOUND` : meta.name,
      sub: h.kind === "quake"
        ? quakeAlertSub(h.remaining, incoming)
        : incoming
        ? `impact in ${fmt(h.remaining)}s`
        : h.kind === "dust"
          ? `solar at ${fmt(cur.solarMul * 100)}% · ${fmt(h.remaining)}s`
          : `${meta.effect} · ${fmt(h.remaining)}s`,
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

  if (brownoutShed(cur.buildings)) {
    out.push({ k: "brown", sev: 2, txt: "BROWNOUT — load shed", sub: "demand exceeds supply" });
  }

  // buildings that are off for a reason other than power: unsealed, unstaffed, …
  out.push(...faultAlerts(cur.buildings));

  // the evil UFO — a rare hostile abductor overhead
  if (cur.ufo && cur.ufo.phase !== "leaving") {
    const grabbing = cur.ufo.phase === "hovering";
    out.push({
      k: "ufo",
      sev: 3,
      txt: grabbing ? "UFO — ABDUCTING" : "UFO INBOUND — abductor",
      sub: grabbing ? "deflectors are the only defense" : "an unknown craft, descending",
    });
  }

  // Earth resupply window open (doc §2.5) — the one "good" alert
  if (cur.resupplyT > 0) {
    out.push({
      k: "resupply",
      sev: 1,
      ...resupplyAlertCopy(cur.resupplyT),
    });
  }

  return out.sort((a, b) => b.sev - a.sev);
});
</script>

<template>
  <div
    class="alerts"
    role="status"
    aria-live="polite"
    aria-atomic="false"
    aria-relevant="additions"
  >
    <component
      :is="it.uids ? 'button' : 'div'"
      v-for="it in items"
      :key="it.k"
      :class="'alert sev' + it.sev"
      :type="it.uids ? 'button' : undefined"
      :title="it.uids ? 'show the next one' : undefined"
      @click="it.uids && focusFault(it.k, it.uids)"
    >
      <span class="alert-bar" aria-hidden="true" />
      <span>
        <span class="alert-txt">{{ it.txt }}</span>
        <span class="alert-sub">{{ it.sub }}</span>
      </span>
    </component>
  </div>
</template>
