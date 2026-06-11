<script setup lang="ts">
/* ============================================================================
   HintToast — a small one-shot teaching card (the FirstHint's quieter sibling).
   The colony store decides WHEN (event/snapshot drivers + the 14 s auto-dismiss
   + the seen-set); this component only renders the active hint. It lives in the
   pointer-events:none hint layer — only the card itself is interactive.
   ============================================================================ */
import { useColony } from "@/ui/stores/colony";

const { hintToast, dismissHint } = useColony();
</script>

<template>
  <transition name="toast">
    <div v-if="hintToast" class="toast" :key="hintToast.id">
      <div class="toast-head">
        <span class="toast-dot" />
        <span class="toast-title">{{ hintToast.title }}</span>
        <button class="toast-x" title="Dismiss" @click="dismissHint">✕</button>
      </div>
      <p class="toast-body">{{ hintToast.body }}</p>
    </div>
  </transition>
</template>

<style scoped>
.toast {
  pointer-events: auto;
  width: 300px;
  background: var(--panel);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(127, 212, 232, 0.32);
  border-radius: 6px;
  padding: 11px 13px 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  font-family: var(--mono);
  color: var(--ink);
}
.toast-head { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.toast-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--cyan);
  box-shadow: 0 0 8px var(--cyan); animation: pulse 2.6s ease-in-out infinite;
}
.toast-title { flex: 1; font-size: 10px; letter-spacing: 0.22em; color: var(--cyan); }
.toast-x { font-size: 10px; color: var(--dim); padding: 1px 4px; border-radius: 3px; transition: 0.14s; }
.toast-x:hover { color: var(--ink); background: rgba(127, 212, 232, 0.1); }
.toast-body { font-size: 11px; line-height: 1.5; color: var(--ink); margin: 0; }

.toast-enter-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.toast-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
