/* ============================================================================
   VIVARIUM — entry point.
   Mounts the Vue app. The heavy three.js renderer is dynamically imported from
   within the app once the colony view is shown, so it never lands in the main
   page bundle (doc §1 — lazy-loaded behind the Easter-egg trigger).
   ============================================================================ */
import { createApp } from "vue";
import App from "./ui/App.vue";
import "./ui/style/tokens.css";
import "./ui/style/hud.css";

createApp(App).mount("#root");
