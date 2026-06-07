<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { useColony } from "@/ui/stores/colony";
import TypedText from "./TypedText.vue";

const { messages } = useColony();
const body = ref<HTMLElement | null>(null);

watch(
  messages,
  () => {
    nextTick(() => {
      const el = body.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  },
  { deep: false },
);
</script>

<template>
  <div class="term">
    <div class="term-head">
      <span class="term-eye" />
      <span class="term-id">THE COUNCIL</span>
      <span class="term-status">OBSERVING</span>
    </div>
    <div ref="body" class="term-body">
      <div v-for="m in messages" :key="m.id" class="term-line" :class="'voice-' + m.register">
        <span class="term-ts">[{{ m.sol }}.{{ m.clock }}]</span>
        <span class="term-speaker">{{ m.speaker }}</span>
        <TypedText :text="m.text" />
      </div>
    </div>
  </div>
</template>
