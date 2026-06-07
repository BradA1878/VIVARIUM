<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";

const props = defineProps<{ text: string }>();

const n = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

function stop(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function reveal(): void {
  stop();
  n.value = 0;
  let i = 0;
  timer = setInterval(() => {
    i += 1;
    n.value = i;
    if (i >= props.text.length) stop();
  }, 16);
}

onMounted(reveal);
onUnmounted(stop);
watch(() => props.text, reveal);
</script>

<template>
  <span class="term-txt">{{ text.slice(0, n) }}<span v-if="n < text.length" class="term-caret">█</span></span>
</template>
