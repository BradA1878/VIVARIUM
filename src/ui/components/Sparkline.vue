<script setup lang="ts">
/* Sparkline — one run-telemetry curve on a crisp 2D canvas (sized at the
   devicePixelRatio so the hairline stays a hairline on retina). Min/max
   normalized; a single polyline, a 12%-alpha area fill to the baseline, an end
   dot, and the min/max in 8px mono. Pure display — no store, no bridge. */
import { onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{ values: number[]; color: string; w?: number; h?: number; label: string }>(),
  { w: 150, h: 44 },
);

const cv = ref<HTMLCanvasElement | null>(null);

function draw(): void {
  const c = cv.value;
  const g = c?.getContext("2d");
  if (!c || !g) return;
  const dpr = window.devicePixelRatio || 1;
  c.width = props.w * dpr;
  c.height = props.h * dpr;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, props.w, props.h);

  const vs = props.values;
  if (vs.length < 2) return;
  let min = Infinity, max = -Infinity;
  for (const v of vs) { if (v < min) min = v; if (v > max) max = v; }
  const span = max - min || 1;
  const top = 4, bottom = props.h - 11; // leave room for the min label row
  const X = (i: number) => (i / (vs.length - 1)) * (props.w - 6) + 1;
  const Y = (v: number) => bottom - ((v - min) / span) * (bottom - top);

  // area fill to the baseline, then the line itself, then the end dot
  g.beginPath();
  g.moveTo(X(0), bottom);
  for (let i = 0; i < vs.length; i++) g.lineTo(X(i), Y(vs[i]));
  g.lineTo(X(vs.length - 1), bottom);
  g.closePath();
  g.globalAlpha = 0.12;
  g.fillStyle = props.color;
  g.fill();
  g.globalAlpha = 1;

  g.beginPath();
  g.moveTo(X(0), Y(vs[0]));
  for (let i = 1; i < vs.length; i++) g.lineTo(X(i), Y(vs[i]));
  g.strokeStyle = props.color;
  g.lineWidth = 1;
  g.stroke();

  g.beginPath();
  g.arc(X(vs.length - 1), Y(vs[vs.length - 1]), 1.8, 0, Math.PI * 2);
  g.fillStyle = props.color;
  g.fill();

  // min/max in 8px mono — the machine annotating its own chart
  g.font = "8px 'IBM Plex Mono', ui-monospace, monospace";
  g.fillStyle = "rgba(106, 122, 130, 0.9)"; // --dim
  const f = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString());
  g.fillText(f(max), 2, 8);
  g.fillText(f(min), 2, props.h - 2);
}

onMounted(draw);
watch(() => props.values, draw);
</script>

<template>
  <div class="spark">
    <div class="spark-label" :style="{ color }">{{ label }}</div>
    <canvas ref="cv" :style="{ width: w + 'px', height: h + 'px' }" />
  </div>
</template>

<style scoped>
.spark { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
.spark-label { font-family: var(--mono); font-size: 8.5px; letter-spacing: 0.22em; opacity: 0.9; }
.spark canvas { display: block; }
</style>
