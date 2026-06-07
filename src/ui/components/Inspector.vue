<script setup lang="ts">
/* Inspector chip — what's under the cursor or what's being placed (doc §4.3
   bottom-center). Shows the active tool, the demolish mode, or the building the
   cursor is hovering over. */
import { computed } from "vue";
import { useColony } from "@/ui/stores/colony";
import { DEFS } from "@/engine";

const { tool, demolish, hover } = useColony();

const toolDef = computed(() => (tool.value ? DEFS[tool.value] : null));
const hoverDef = computed(() => (hover.value?.defId ? DEFS[hover.value.defId] : null));
</script>

<template>
  <div v-if="demolish" class="inspect demo">
    DEMOLISH — click a structure to remove · right-click to cancel
  </div>
  <div v-else-if="toolDef" class="inspect">
    <span class="ins-glyph">{{ toolDef.glyph }}</span>
    <span class="ins-name">PLACING {{ toolDef.name.toUpperCase() }}</span>
    <span class="ins-hint">click to place · right-click to cancel</span>
  </div>
  <div v-else-if="hoverDef" class="inspect">
    <span class="ins-glyph">{{ hoverDef.glyph }}</span>
    <span class="ins-name">{{ hoverDef.name.toUpperCase() }}</span>
    <span class="ins-hint">{{ hoverDef.foot[0] }}×{{ hoverDef.foot[1] }}{{ hoverDef.requiresPressure ? " · sealed" : "" }}</span>
  </div>
</template>
