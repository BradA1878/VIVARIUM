import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

// Vite config. The three.js renderer is lazy-loaded behind the Easter-egg
// trigger (see index.html / src/main.ts) so the heavy bundle stays off the
// main page — doc §1.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    port: 5180,
    // Proxy the narrator / persistence API to the Hono server in dev so the
    // provider key never touches the client (doc §3.2).
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
