import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ||
        "postgresql://episteme:episteme@localhost:5433/episteme",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ||
        "test-secret-for-integration-tests-only-not-for-prod",
      BETTER_AUTH_URL:
        process.env.BETTER_AUTH_URL || "http://localhost:3001",
    },
  },
  resolve: {
    alias: {
      "@episteme/db/schema": path.resolve(
        __dirname,
        "../../packages/db/src/schema/index.ts",
      ),
      "@episteme/db/client": path.resolve(
        __dirname,
        "../../packages/db/src/client.ts",
      ),
      "@episteme/db": path.resolve(
        __dirname,
        "../../packages/db/src/index.ts",
      ),
      "@episteme/auth": path.resolve(
        __dirname,
        "../../packages/auth/src/index.ts",
      ),
    },
  },
});
