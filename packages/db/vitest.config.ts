import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/**/__tests__/**/*.test.ts",
      "src/**/*.test.ts",
      "scripts/**/__tests__/**/*.test.ts",
    ],
    environment: "node",
  },
});
