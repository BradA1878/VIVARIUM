<script setup lang="ts">
import { computed } from "vue";
import { useColony } from "@/ui/stores/colony";
import { fmt, clockOf } from "@/ui/format";

const { snapshot } = useColony();
const s = computed(() => snapshot.value);

const day = computed(() => s.value != null && s.value.tod > 0.22 && s.value.tod < 0.80);
const storm = computed(() => s.value?.weather === "dust");
const ang = computed(() => (s.value ? s.value.tod * 2 * Math.PI - Math.PI / 2 : 0));

function arcPath(cx: number, cy: number, r: number, t0: number, t1: number): string {
  const a0 = t0 * 2 * Math.PI - Math.PI / 2;
  const a1 = t1 * 2 * Math.PI - Math.PI / 2;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = t1 - t0 > 0.5 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}
</script>

<template>
  <div v-if="s" class="clock">
    <div class="clock-dial">
      <svg viewBox="0 0 56 56" width="56" height="56">
        <circle cx="28" cy="28" r="25" fill="none" stroke="rgba(127,212,232,0.14)" stroke-width="1" />
        <path :d="arcPath(28, 28, 25, 0.22, 0.80)" fill="none" stroke="rgba(200,121,79,0.5)" stroke-width="2" />
        <circle
          :cx="28 + 25 * Math.cos(ang)"
          :cy="28 + 25 * Math.sin(ang)"
          r="3"
          :fill="day ? (storm ? '#c8794f' : '#7fd4e8') : '#3a464c'"
          :style="{ filter: day ? 'drop-shadow(0 0 4px currentColor)' : 'none' }"
        />
        <text x="28" y="25" text-anchor="middle" class="clock-sol">SOL</text>
        <text x="28" y="38" text-anchor="middle" class="clock-num">{{ s.sol }}</text>
      </svg>
    </div>
    <div class="clock-info">
      <div class="clock-time">{{ clockOf(s.tod) }}</div>
      <div class="clock-phase">
        {{ day ? (s.tod < 0.5 ? "MORNING" : "AFTERNOON") : (s.tod > 0.84 || s.tod < 0.20 ? "NIGHT" : "TWILIGHT") }}
      </div>
      <div :class="['clock-wx', { storm }]">
        {{ storm ? `⛈ DUST STORM · ${fmt(s.stormT)}s` : `○ CLEAR · solar ${fmt(s.solarMul * 100)}%` }}
      </div>
    </div>
  </div>
</template>
