import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

// Vite config. The three.js renderer is lazy-loaded behind the Easter-egg
// trigger (see index.html / src/main.ts) so the heavy bundle stays off the
// main page — doc §1.
export default defineConfig({
  // Base public path. Unset → "/" (standalone dev/build, byte-identical to the
  // previous behavior). The parent site embeds the game under /vivarium/, so
  // `npm run build:egg` sets VIV_BASE=/vivarium/ and every emitted asset URL
  // (index.html assets, the sim-worker chunk, lazy renderer chunks) is rebased.
  base: process.env.VIV_BASE || "/",
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
    // provider key never touches the client (doc §3.2). If the server isn't
    // running, answer the proxy error quietly with a 502 (the client falls back
    // to scripted lines / localStorage) instead of spamming ECONNREFUSED stacks.
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (_err, _req, res) => {
            const r = res as { writeHead?: (s: number, h: Record<string, string>) => void; end?: (b?: string) => void; headersSent?: boolean };
            if (r.writeHead && r.end && !r.headersSent) {
              r.writeHead(502, { "content-type": "application/json" });
              r.end(JSON.stringify({ error: "narrator server offline", fallback: "scripted" }));
            }
          });
        },
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
