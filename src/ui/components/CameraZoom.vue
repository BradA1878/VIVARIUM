<script setup lang="ts">
/* ============================================================================
   CameraZoom — an always-visible, input-agnostic zoom surface. Native buttons
   keep the control keyboard and screen-reader operable; the store routes them
   into the renderer's same bounded zoom path used by the mouse wheel.
   ============================================================================ */
import { useColony } from "../stores/colony";

const { controls } = useColony();
</script>

<template>
  <div class="camera-zoom" role="group" aria-label="Camera zoom controls">
    <span class="camera-zoom-label" aria-hidden="true">ZOOM</span>
    <button
      class="camera-zoom-button"
      type="button"
      aria-label="Zoom camera in"
      title="Zoom camera in"
      @click="controls.zoomCamera('in')"
    >
      <span aria-hidden="true">+</span>
    </button>
    <button
      class="camera-zoom-button"
      type="button"
      aria-label="Zoom camera out"
      title="Zoom camera out"
      @click="controls.zoomCamera('out')"
    >
      <span aria-hidden="true">−</span>
    </button>
  </div>
</template>

<style scoped>
.camera-zoom {
  pointer-events: auto;
  position: absolute;
  top: 56px;
  left: 328px;
  z-index: 8;
  width: 40px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--ink);
  background: var(--panel);
  border: 1px solid var(--hair);
  border-radius: 3px;
  backdrop-filter: blur(9px);
  -webkit-backdrop-filter: blur(9px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.42);
}

.camera-zoom-label {
  padding: 5px 0 4px;
  color: var(--faint);
  border-bottom: 1px solid var(--hair2);
  font-size: 7px;
  line-height: 1;
  letter-spacing: 0.13em;
  text-align: center;
}

.camera-zoom-button {
  width: 100%;
  min-height: 34px;
  display: grid;
  place-items: center;
  color: var(--dim);
  background: rgba(255, 255, 255, 0.012);
  font-size: 21px;
  font-weight: 300;
  line-height: 1;
  transition: color 0.13s, background 0.13s;
}

.camera-zoom-button + .camera-zoom-button {
  border-top: 1px solid var(--hair2);
}

.camera-zoom-button:hover {
  color: var(--cyan);
  background: rgba(127, 212, 232, 0.08);
}

.camera-zoom-button:active {
  color: #e6eef1;
  background: rgba(127, 212, 232, 0.16);
}

@media (max-width: 1480px) {
  .camera-zoom { left: 308px; }
}

@media (max-width: 1180px) {
  .camera-zoom { left: 292px; }
}

@media (max-width: 880px) {
  .camera-zoom { left: 276px; }
}

/* Tablet/coarse layouts keep the control in the narrow canvas lane beside the
   status rail and grow both actions to the 44px touch-target floor. */
@media (max-width: 900px), (pointer: coarse) {
  .camera-zoom {
    top: 54px;
    left: calc(min(248px, calc(50vw - 12px)) + 16px);
    width: 46px;
  }
  .camera-zoom-label { padding-block: 4px; }
  .camera-zoom-button { min-height: 44px; }
}

@media (max-width: 700px) {
  .camera-zoom { left: calc(min(236px, calc(50vw - 12px)) + 16px); }
}

/* A phone guest sheds both rails. Dock the secondary camera control below the
   vitals strip, clear of the thumb movement/action cluster at the bottom. */
:global(.hud--phone) .camera-zoom {
  top: 52px;
  right: 8px;
  left: auto;
}

@media (prefers-reduced-motion: reduce) {
  .camera-zoom-button { transition: none; }
}
</style>
