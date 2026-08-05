<template>
  <div class="viewport-gate" role="alert" aria-labelledby="viewport-title">
    <div class="viewport-card">
      <div class="viewport-mark" aria-hidden="true">◇</div>
      <h1 id="viewport-title">WIDER CONSOLE REQUIRED</h1>
      <p>
        VIVARIUM’s colony map and life-support rails need at least a 560 × 440 viewport.
        Rotate a tablet, enlarge this window, or continue on a laptop or desktop.
      </p>
      <span>Your colony save remains intact.</span>
    </div>
  </div>
</template>

<style scoped>
.viewport-gate {
  position: absolute;
  inset: 0;
  z-index: 120;
  display: none;
  place-items: center;
  padding: 24px;
  pointer-events: auto;
  background: radial-gradient(120% 100% at 50% 40%, #0b1115, #040507);
  font-family: var(--mono);
}
.viewport-card { width: min(390px, 100%); text-align: center; }
.viewport-mark { margin-bottom: 15px; color: var(--cyan); font-size: 30px; text-shadow: 0 0 18px rgba(127, 212, 232, 0.5); }
.viewport-card h1 { margin: 0 0 12px; color: #e6eef1; font-size: 14px; font-weight: 500; letter-spacing: 0.2em; }
.viewport-card p { margin: 0 0 12px; color: var(--ink); font-family: var(--serif); font-size: 15px; font-style: italic; line-height: 1.55; }
.viewport-card span { color: var(--dim); font-size: 10px; letter-spacing: 0.08em; }

@media (max-width: 559px), (max-height: 439px) {
  .viewport-gate { display: grid; }
}
</style>
