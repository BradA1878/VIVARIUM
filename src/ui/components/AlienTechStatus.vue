<script setup lang="ts">
import { computed } from "vue";
import { TECH_DEFS } from "@/engine";
import { useColony } from "@/ui/stores/colony";

const { snapshot } = useColony();
const techs = computed(() => (snapshot.value?.acquiredTech ?? []).map((id) => ({
  id,
  name: TECH_DEFS[id]?.name ?? id,
  glyph: TECH_DEFS[id]?.glyph ?? "◇",
  effect: TECH_DEFS[id]?.desc ?? "Recovered alien system; effect active for this colony.",
})));
</script>

<template>
  <section
    v-if="techs.length"
    class="alien-tech"
    aria-labelledby="alien-tech-title"
    role="status"
    aria-live="polite"
  >
    <div class="tech-head">
      <h2 id="alien-tech-title">ALIEN TECH</h2>
      <span>{{ techs.length ? `${techs.length} ACTIVE` : "NONE" }}</span>
    </div>
    <ul class="tech-list">
      <li v-for="tech in techs" :key="tech.id">
        <span class="tech-glyph" aria-hidden="true">{{ tech.glyph }}</span>
        <span class="tech-copy">
          <strong>{{ tech.name }}</strong>
          <span>{{ tech.effect }}</span>
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.alien-tech {
  pointer-events: auto;
  width: 100%;
  padding: 10px 11px;
  color: var(--ink);
  background: rgba(21, 15, 31, 0.9);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(176, 130, 232, 0.48);
  border-radius: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), inset 0 0 18px rgba(176, 130, 232, 0.04);
}
.tech-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.tech-head h2 { margin: 0; font-size: 9px; font-weight: 500; letter-spacing: 0.24em; color: var(--dim); }
.tech-head > span { font-size: 8.5px; letter-spacing: 0.12em; color: #c7a6f2; }
.tech-list { display: grid; gap: 6px; list-style: none; margin: 8px 0 0; padding: 0; }
.tech-list li { display: flex; gap: 8px; align-items: flex-start; }
.tech-glyph { flex: 0 0 18px; color: #c7a6f2; text-align: center; text-shadow: 0 0 8px rgba(176, 130, 232, 0.45); }
.tech-copy { display: grid; gap: 2px; min-width: 0; }
.tech-copy strong { font-size: 10px; font-weight: 500; letter-spacing: 0.07em; color: #decafa; }
.tech-copy > span { font-family: var(--serif); font-style: italic; font-size: 11px; line-height: 1.3; color: var(--dim); }
</style>
