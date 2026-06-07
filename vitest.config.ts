import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Engine tests run in plain Node — the sim is pure TS with no DOM/three/async,
// so it needs no jsdom. (Doc §0: the engine is deterministic and standalone.)
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "shared/**/*.test.ts"],
  },
});
