import { defineConfig } from "vitest/config";
import path from "path";
import { configDotenv } from "dotenv";

// Load .env.local so DATABASE_URL is available in tests
configDotenv({ path: path.resolve(__dirname, ".env.local") });

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
