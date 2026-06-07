<script setup lang="ts">
/* Cold-open overlay: the giant italic VIVARIUM wordmark + a boot log that fades
   out, ending on the narrator waking (doc §4.3). */
import { ref, onMounted, onUnmounted } from "vue";

const emit = defineEmits<{ done: [] }>();

const seq = [
  "VIVARIUM life-support kernel — cold start",
  "pressure seal … nominal",
  "telemetry bus … online",
  "narrator … awake",
];

const step = ref(0);
const leaving = ref(false);
let timers: ReturnType<typeof setTimeout>[] = [];

function finish() {
  if (leaving.value) return;
  leaving.value = true;
  setTimeout(() => emit("done"), 480);
}

onMounted(() => {
  timers = seq.map((_, i) => setTimeout(() => (step.value = i + 1), 350 + i * 420));
  // auto-dismiss after the log completes
  timers.push(setTimeout(finish, 350 + seq.length * 420 + 700));
});
onUnmounted(() => timers.forEach(clearTimeout));
</script>

<template>
  <div class="boot" :class="{ out: leaving }" @click="finish">
    <div class="boot-inner">
      <div class="boot-mark">VIVARIUM</div>
      <div class="boot-log">
        <div v-for="(line, i) in seq.slice(0, step)" :key="i" class="boot-row">
          <span>{{ line }}</span><span class="boot-ok">OK</span>
        </div>
      </div>
      <div class="boot-hint">click to enter</div>
    </div>
  </div>
</template>
