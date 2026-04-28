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
      "@episteme/auth/server": path.resolve(__dirname, "../../packages/auth/src/server.ts"),
      "@episteme/auth/byok": path.resolve(__dirname, "../../packages/auth/src/byok.ts"),
      "@episteme/auth/client": path.resolve(__dirname, "../../packages/auth/src/client.ts"),
      "@episteme/auth/encryption": path.resolve(__dirname, "../../packages/auth/src/encryption.ts"),
      "@episteme/auth/internal": path.resolve(__dirname, "../../packages/auth/src/internal.ts"),
      "@episteme/auth": path.resolve(__dirname, "../../packages/auth/src/index.ts"),
      "@episteme/db/schema": path.resolve(__dirname, "../../packages/db/src/schema/index.ts"),
      "@episteme/db/client": path.resolve(__dirname, "../../packages/db/src/client.ts"),
      "@episteme/db": path.resolve(__dirname, "../../packages/db/src/index.ts"),
    },
  },
});
