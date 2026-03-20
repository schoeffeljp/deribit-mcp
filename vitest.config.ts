import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000, // API calls can be slow
    hookTimeout: 15_000,
  },
});
