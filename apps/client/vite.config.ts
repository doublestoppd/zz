import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
  test: {
    // Pure helpers only; Phaser scenes are covered by typecheck, not tests.
    include: ["src/**/*.test.ts"],
  },
});
