<script setup lang="ts">
/* Top HUD bar: the VIVARIUM wordmark plus sim controls (storm, reset, pause,
   speed) and the settings gear. Mirrors the prototype TopBar — the HUD only
   issues commands and reads the snapshot, never the tick. */
import { computed } from "vue";
import { useColony } from "@/ui/stores/colony";
import { useSettings } from "@/ui/stores/settings";

const { snapshot, controls } = useColony();
const { settingsOpen } = useSettings();
const s = computed(() => snapshot.value);

const speeds: readonly number[] = [1, 2, 4];
</script>

<template>
  <div v-if="s" class="topbar">
    <div class="brand">
      <span class="brand-mark" />
      <span class="brand-name">VIVARIUM</span>
      <span class="brand-sub">life-support console · colony 7-MX</span>
    </div>
    <div class="controls">
      <button class="ctl" title="Force a dust storm" @click="controls.storm()">⛈ storm</button>
      <button class="ctl" title="Restart colony" @click="controls.reset()">↺ reset</button>
      <div class="ctl-sep" />
      <button class="ctl" :class="{ on: s.paused }" @click="controls.togglePause()">
        {{ s.paused ? "▶ resume" : "❚❚ pause" }}
      </button>
      <button
        v-for="sp in speeds"
        :key="sp"
        class="ctl spd"
        :class="{ on: s.speed === sp && !s.paused }"
        @click="controls.setSpeed(sp)"
      >
        {{ sp }}×
      </button>
      <div class="ctl-sep" />
      <button
        class="ctl"
        :class="{ on: settingsOpen }"
        title="Settings"
        @click="settingsOpen = !settingsOpen"
      >
        ⚙ settings
      </button>
    </div>
  </div>
</template>
