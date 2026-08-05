<script setup lang="ts">
/* Inspector chip — what's under the cursor or what's being placed (doc §4.3
   bottom-center). Shows the active tool, the demolish mode, or the building the
   cursor is hovering over. */
import { computed } from "vue";
import { useColony } from "@/ui/stores/colony";
import { DEFS } from "@/engine";

const { tool, demolish, hover, selected, clearTool, rotate, capabilities } = useColony();

const linking = computed(() => tool.value === "corridor");
const toolDef = computed(() => (tool.value && tool.value !== "corridor" ? DEFS[tool.value] : null));
const selectedDef = computed(() => (selected.value ? DEFS[selected.value.defId] : null));
const hoverDef = computed(() => (hover.value?.defId ? DEFS[hover.value.defId] : null));
const hoverHasDoor = computed(() => hoverDef.value?.door != null);
</script>

<template>
  <div v-if="demolish && capabilities.canBuild" class="inspect demo">
    <span>DEMOLISH — click a structure to remove · right-click or Cancel to stop</span>
    <button class="inspect-touch" type="button" @click="clearTool">CANCEL</button>
  </div>
  <div v-else-if="selectedDef && capabilities.canBuild" class="inspect">
    <span class="ins-glyph">{{ selectedDef.glyph }}</span>
    <span class="ins-name">SELECTED {{ selectedDef.name.toUpperCase() }}</span>
    <span class="ins-hint">click a cell to move{{ selectedDef.door != null ? " · R rotate" : "" }} · Del remove · right-click or Drop to release</span>
    <span class="inspect-actions">
      <button v-if="selectedDef.door != null" class="inspect-touch" type="button" @click="rotate">ROTATE</button>
      <button class="inspect-touch" type="button" @click="clearTool">DROP</button>
    </span>
  </div>
  <div v-else-if="linking && capabilities.canBuild" class="inspect">
    <span class="ins-glyph">===</span>
    <span class="ins-name">LINK</span>
    <span class="ins-hint">click two sealed buildings to route a corridor · click ground for one · right-click or Cancel to stop</span>
    <button class="inspect-touch" type="button" @click="clearTool">CANCEL</button>
  </div>
  <div v-else-if="toolDef && capabilities.canBuild" class="inspect">
    <span class="ins-glyph">{{ toolDef.glyph }}</span>
    <span class="ins-name">PLACING {{ toolDef.name.toUpperCase() }}</span>
    <span class="ins-hint">click to place{{ toolDef.door != null ? " · R to rotate the door" : "" }} · right-click or Cancel to stop</span>
    <span class="inspect-actions">
      <button v-if="toolDef.door != null" class="inspect-touch" type="button" @click="rotate">ROTATE</button>
      <button class="inspect-touch" type="button" @click="clearTool">CANCEL</button>
    </span>
  </div>
  <div v-else-if="hoverDef" class="inspect">
    <span class="ins-glyph">{{ hoverDef.glyph }}</span>
    <span class="ins-name">{{ hoverDef.name.toUpperCase() }}</span>
    <span class="ins-hint">{{ hoverDef.foot[0] }}×{{ hoverDef.foot[1] }}{{ hoverDef.requiresPressure ? " · sealed" : "" }}{{ hoverHasDoor && capabilities.canBuild ? " · R to rotate" : "" }}</span>
  </div>
</template>

<style scoped>
.inspect-touch { display: none; }
@media (pointer: coarse), (max-width: 900px) {
  .inspect-actions { display: inline-flex; gap: 5px; }
  .inspect-touch {
    display: inline-block;
    min-height: 34px;
    padding: 5px 9px;
    color: var(--cyan);
    border: 1px solid rgba(127, 212, 232, 0.4);
    border-radius: 3px;
    font-size: 9px;
    letter-spacing: 0.1em;
  }
}
</style>
