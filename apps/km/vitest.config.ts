import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ||
        "postgresql://episteme:episteme@localhost:5433/episteme",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ||
        "test-secret-for-integration-tests-only-not-for-prod",
      BETTER_AUTH_URL:
        process.env.BETTER_AUTH_URL || "http://localhost:3001",
      S3_ENDPOINT: process.env.S3_ENDPOINT || "http://localhost:9000",
      S3_BUCKET: process.env.S3_BUCKET || "episteme-dev",
      S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || "episteme",
      S3_SECRET_KEY: process.env.S3_SECRET_KEY || "episteme-dev",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
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
      "@episteme/markdown": path.resolve(
        __dirname,
        "../../packages/markdown/src/index.ts",
      ),
      "@episteme/editor": path.resolve(
        __dirname,
        "../../packages/editor/src/index.ts",
      ),
      "@episteme/storage": path.resolve(
        __dirname,
        "../../packages/storage/src/index.ts",
      ),
      "@episteme/auth/byok": path.resolve(
        __dirname,
        "../../packages/auth/src/byok.ts",
      ),
      "@episteme/auth/client": path.resolve(
        __dirname,
        "../../packages/auth/src/client.ts",
      ),
      "@episteme/auth": path.resolve(
        __dirname,
        "../../packages/auth/src/index.ts",
      ),
      "@episteme/notes-core": path.resolve(
        __dirname,
        "../../packages/notes-core/src/index.ts",
      ),
    },
  },
});
