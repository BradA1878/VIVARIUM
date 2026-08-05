import { defineConfig } from "vite";

// Bundle only the server entry; dependencies remain external Node imports.
// This produces a deployable artifact instead of relying on the development
// `tsx watch` process in production.
export default defineConfig({
  build: {
    ssr: "server/index.ts",
    target: "node22",
    outDir: "dist-server",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: { entryFileNames: "index.mjs" },
    },
  },
});
