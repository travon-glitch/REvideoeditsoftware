import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ["./tsconfig.json"] })],
  test: {
    environment: "node",
    include: process.env.LVS_RENDER_TESTS ? ["tests/render/**/*.test.ts"] : ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: process.env.LVS_RENDER_TESTS ? [] : ["tests/render/**", "node_modules/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    alias: {
      // "server-only" throws outside React Server Components; tests import server modules directly.
      "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname,
    },
  },
});
