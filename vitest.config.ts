import { defineConfig } from "vitest/config";

// One root config runs every package's tests with `pnpm test`.
// Each project is a directory; its tests live next to the code as `*.test.ts`.
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
  },
});
