<script setup lang="ts">
import { computed } from "vue";
import { useColony } from "@/ui/stores/colony";
import { alienTechView } from "@/ui/alienTech";

const { snapshot, alienTechReveal } = useColony();
const techs = computed(() => (snapshot.value?.acquiredTech ?? []).map(alienTechView));
</script>

<template>
  <section
    v-if="techs.length"
    class="alien-tech"
    aria-labelledby="alien-tech-title"
  >
    <div class="tech-head">
      <h2 id="alien-tech-title">ALIEN TECH</h2>
      <span>PERMANENT · {{ techs.length }} ACTIVE</span>
    </div>
    <ul class="tech-list">
      <li
        v-for="tech in techs"
        :key="tech.id"
        :class="{ integrating: alienTechReveal?.techId === tech.id }"
      >
        <span class="tech-glyph" aria-hidden="true">{{ tech.glyph }}</span>
        <span class="tech-copy">
          <strong>{{ tech.name }}</strong>
          <span>{{ tech.effect }}</span>
        </span>
      </li>
    </ul>
    <p class="tech-foot">Active now and retained after the traders depart.</p>
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
.tech-list li { display: flex; gap: 8px; align-items: flex-start; margin: 0 -4px; padding: 3px 4px; border-left: 1px solid transparent; }
.tech-list li.integrating {
  background: rgba(176, 130, 232, 0.1);
  border-left-color: #b082e8;
  animation: integrated 0.72s ease-out 1 both;
}
.tech-glyph { flex: 0 0 18px; color: #c7a6f2; text-align: center; text-shadow: 0 0 8px rgba(176, 130, 232, 0.45); }
.tech-copy { display: grid; gap: 2px; min-width: 0; }
.tech-copy strong { font-size: 10px; font-weight: 500; letter-spacing: 0.07em; color: #decafa; }
.tech-copy > span { font-size: 9.5px; line-height: 1.35; color: var(--ink); }
.tech-foot {
  margin: 8px 0 0;
  padding-top: 7px;
  color: var(--faint);
  border-top: 1px solid rgba(176, 130, 232, 0.14);
  font-size: 8px;
  letter-spacing: 0.08em;
  line-height: 1.35;
  text-transform: uppercase;
}

@keyframes integrated {
  from { filter: brightness(1.8); transform: translateX(-3px); }
  to { filter: brightness(1); transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .tech-list li.integrating { animation: none; }
}
</style>
