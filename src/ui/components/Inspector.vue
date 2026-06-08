<script setup lang="ts">
/* Inspector chip — what's under the cursor or what's being placed (doc §4.3
   bottom-center). Shows the active tool, the demolish mode, or the building the
   cursor is hovering over. */
import { computed } from "vue";
import { useColony } from "@/ui/stores/colony";
import { DEFS } from "@/engine";

const { tool, demolish, hover, selected } = useColony();

const linking = computed(() => tool.value === "corridor");
const toolDef = computed(() => (tool.value && tool.value !== "corridor" ? DEFS[tool.value] : null));
const selectedDef = computed(() => (selected.value ? DEFS[selected.value.defId] : null));
const hoverDef = computed(() => (hover.value?.defId ? DEFS[hover.value.defId] : null));
const hoverHasDoor = computed(() => hoverDef.value?.door != null);
</script>

<template>
  <div v-if="demolish" class="inspect demo">
    DEMOLISH — click a structure to remove · right-click to cancel
  </div>
  <div v-else-if="selectedDef" class="inspect">
    <span class="ins-glyph">{{ selectedDef.glyph }}</span>
    <span class="ins-name">SELECTED {{ selectedDef.name.toUpperCase() }}</span>
    <span class="ins-hint">click a cell to move{{ selectedDef.door != null ? " · R rotate" : "" }} · Del remove · right-click to drop</span>
  </div>
  <div v-else-if="linking" class="inspect">
    <span class="ins-glyph">===</span>
    <span class="ins-name">LINK</span>
    <span class="ins-hint">click two sealed buildings to route a corridor · click ground for one · right-click to cancel</span>
  </div>
  <div v-else-if="toolDef" class="inspect">
    <span class="ins-glyph">{{ toolDef.glyph }}</span>
    <span class="ins-name">PLACING {{ toolDef.name.toUpperCase() }}</span>
    <span class="ins-hint">click to place{{ toolDef.door != null ? " · R to rotate the door" : "" }} · right-click to cancel</span>
  </div>
  <div v-else-if="hoverDef" class="inspect">
    <span class="ins-glyph">{{ hoverDef.glyph }}</span>
    <span class="ins-name">{{ hoverDef.name.toUpperCase() }}</span>
    <span class="ins-hint">{{ hoverDef.foot[0] }}×{{ hoverDef.foot[1] }}{{ hoverDef.requiresPressure ? " · sealed" : "" }}{{ hoverHasDoor ? " · R to rotate" : "" }}</span>
  </div>
</template>
