<script setup lang="ts">
import { computed } from "vue";
import { alienTechView } from "@/ui/alienTech";
import { useColony } from "@/ui/stores/colony";

const { alienTechReveal, dismissAlienTechReveal } = useColony();
const tech = computed(() => alienTechReveal.value
  ? alienTechView(alienTechReveal.value.techId)
  : null);
const announcement = computed(() => tech.value
  ? `Alien technology integrated: ${tech.value.name}. Permanent effect active now: ${tech.value.effect} This technology stays with this colony.`
  : "");
</script>

<template>
  <!-- Mounted empty before any acquisition, then updated: this is announced
       reliably where inserting an already-populated live region is not. -->
  <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</span>
  <Transition name="tech-acquired">
    <div
      v-if="alienTechReveal && tech"
      :key="alienTechReveal.nonce"
      class="tech-reveal-layer"
    >
      <aside class="tech-reveal" aria-labelledby="alien-tech-reveal-title">
        <span class="tech-scan" aria-hidden="true" />
        <button
          class="tech-close"
          type="button"
          title="Dismiss alien tech notice"
          aria-label="Dismiss alien tech notice"
          @click="dismissAlienTechReveal"
        >
          ✕
        </button>

        <header class="tech-reveal-head">
          <span><i aria-hidden="true" /> NONHUMAN SYSTEM INTEGRATED</span>
          <b>PERMANENT UPGRADE</b>
        </header>

        <div class="tech-reveal-body">
          <div class="tech-sigil" aria-hidden="true">
            <span>{{ tech.glyph }}</span>
          </div>
          <div class="tech-reveal-copy">
            <h2 id="alien-tech-reveal-title">{{ tech.name }}</h2>
            <p class="tech-lore">{{ tech.lore }}</p>
            <div class="tech-effect">
              <span>ACTIVE EFFECT</span>
              <strong>{{ tech.effect }}</strong>
            </div>
          </div>
        </div>

        <footer class="tech-reveal-foot">
          <span class="tech-active"><i aria-hidden="true" /> ACTIVE NOW</span>
          <p>The traders will leave. This technology stays with this colony.</p>
          <span class="tech-tracked">TRACKED IN ALIEN TECH →</span>
        </footer>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.tech-reveal-layer {
  position: relative;
  width: min(540px, 100%);
  display: grid;
  place-items: start center;
  pointer-events: none;
  font-family: var(--mono);
}

.tech-reveal {
  position: relative;
  isolation: isolate;
  width: min(540px, 100%);
  overflow: hidden;
  padding: 14px 17px 13px;
  color: #f0e8ff;
  pointer-events: none;
  background:
    linear-gradient(120deg, rgba(176, 130, 232, 0.11), transparent 42%),
    radial-gradient(circle at 11% 46%, rgba(176, 130, 232, 0.18), transparent 33%),
    rgba(16, 10, 25, 0.96);
  border: 1px solid rgba(199, 166, 242, 0.78);
  border-radius: 2px;
  box-shadow:
    0 18px 52px rgba(0, 0, 0, 0.72),
    0 0 32px rgba(176, 130, 232, 0.16),
    inset 0 0 34px rgba(176, 130, 232, 0.06);
}

.tech-reveal::before,
.tech-reveal::after {
  content: "";
  position: absolute;
  z-index: -1;
  pointer-events: none;
}
.tech-reveal::before {
  inset: 0;
  opacity: 0.18;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent 3px,
    rgba(216, 190, 255, 0.12) 4px
  );
}
.tech-reveal::after {
  inset: 5px;
  border: 1px solid rgba(199, 166, 242, 0.1);
}

.tech-scan {
  position: absolute;
  z-index: 2;
  top: 0;
  bottom: 0;
  width: 44%;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(226, 204, 255, 0.15), transparent);
  transform: translateX(-160%) skewX(-18deg);
  animation: tech-scan 0.78s ease-out 0.08s 1 both;
}

.tech-close {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  min-width: 28px;
  min-height: 28px;
  padding: 4px;
  pointer-events: auto;
  color: rgba(222, 202, 250, 0.72);
  border: 1px solid transparent;
  border-radius: 2px;
  font: 10px var(--mono);
}
.tech-close:hover,
.tech-close:focus-visible {
  color: #f0e8ff;
  border-color: rgba(199, 166, 242, 0.42);
  background: rgba(176, 130, 232, 0.13);
}

.tech-reveal-head {
  display: flex;
  justify-content: space-between;
  gap: 28px;
  padding-right: 25px;
  font-size: 9px;
  letter-spacing: 0.2em;
}
.tech-reveal-head > span { color: #d3b6fa; }
.tech-reveal-head > b { color: #9bd6a0; font-size: 8.5px; font-weight: 500; white-space: nowrap; }
.tech-reveal-head i,
.tech-active i {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 6px;
  border-radius: 50%;
  background: #c7a6f2;
  box-shadow: 0 0 10px #b082e8;
}

.tech-reveal-body {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 15px;
  margin-top: 13px;
}
.tech-sigil {
  position: relative;
  width: 66px;
  height: 66px;
  display: grid;
  place-items: center;
  color: #e3d0ff;
  background: rgba(176, 130, 232, 0.08);
  border: 1px solid rgba(199, 166, 242, 0.55);
  transform: rotate(45deg);
  box-shadow: inset 0 0 18px rgba(176, 130, 232, 0.14), 0 0 18px rgba(176, 130, 232, 0.08);
}
.tech-sigil::before {
  content: "";
  position: absolute;
  inset: 7px;
  border: 1px solid rgba(199, 166, 242, 0.23);
}
.tech-sigil span {
  font-size: 27px;
  line-height: 1;
  text-shadow: 0 0 13px rgba(199, 166, 242, 0.7);
  transform: rotate(-45deg);
}
.tech-reveal-copy h2 {
  margin: 0;
  color: #f0e8ff;
  font-family: var(--serif);
  font-size: 23px;
  font-style: italic;
  font-weight: 400;
  letter-spacing: 0.025em;
}
.tech-lore {
  margin: 3px 0 9px;
  color: rgba(222, 202, 250, 0.7);
  font-family: var(--serif);
  font-size: 12px;
  font-style: italic;
  line-height: 1.35;
}
.tech-effect {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 9px;
  padding: 7px 9px;
  background: rgba(176, 130, 232, 0.1);
  border-left: 2px solid #b082e8;
}
.tech-effect span { color: #b99adb; font-size: 8px; letter-spacing: 0.15em; white-space: nowrap; }
.tech-effect strong { color: #f0e8ff; font-size: 11px; font-weight: 500; line-height: 1.4; }

.tech-reveal-foot {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  margin-top: 13px;
  padding-top: 9px;
  border-top: 1px solid rgba(199, 166, 242, 0.16);
}
.tech-reveal-foot p { margin: 0; color: rgba(230, 238, 241, 0.82); font-size: 9px; line-height: 1.35; }
.tech-active,
.tech-tracked { font-size: 8px; letter-spacing: 0.13em; white-space: nowrap; }
.tech-active { color: #9bd6a0; }
.tech-active i { width: 5px; height: 5px; margin-right: 4px; background: #9bd6a0; box-shadow: 0 0 8px #9bd6a0; }
.tech-tracked { color: #c7a6f2; }

.tech-acquired-enter-active { animation: tech-arrive 0.56s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.tech-acquired-leave-active { transition: opacity 0.24s ease, transform 0.24s ease; }
.tech-acquired-leave-to { opacity: 0; transform: translateY(-8px); }

@keyframes tech-arrive {
  0% { opacity: 0; transform: translateY(-13px) scale(0.975); filter: brightness(1.8); }
  56% { opacity: 1; transform: translateY(2px) scale(1.004); filter: brightness(1.15); }
  100% { opacity: 1; transform: none; filter: brightness(1); }
}
@keyframes tech-scan {
  from { transform: translateX(-160%) skewX(-18deg); }
  to { transform: translateX(310%) skewX(-18deg); }
}

@media (max-width: 620px) {
  .tech-reveal { padding: 12px; }
  .tech-reveal-head { display: grid; gap: 4px; padding-right: 44px; font-size: 9px; }
  .tech-reveal-head > b { font-size: 9px; }
  .tech-close { top: 2px; right: 2px; min-width: 44px; min-height: 44px; }
  .tech-reveal-body { grid-template-columns: 50px minmax(0, 1fr); gap: 11px; }
  .tech-sigil { width: 45px; height: 45px; }
  .tech-sigil span { font-size: 20px; }
  .tech-reveal-copy h2 { font-size: 18px; }
  .tech-lore { display: none; }
  .tech-effect { grid-template-columns: 1fr; gap: 3px; }
  .tech-reveal-foot { grid-template-columns: auto 1fr; }
  .tech-active, .tech-tracked { font-size: 9px; }
  .tech-reveal-foot p { font-size: 9.5px; }
  .tech-tracked { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .tech-acquired-enter-active,
  .tech-acquired-leave-active { animation: none; transition: opacity 0.15s ease; }
  .tech-acquired-enter-from,
  .tech-acquired-leave-to { opacity: 0; transform: none; }
  .tech-scan { display: none; }
}
</style>
