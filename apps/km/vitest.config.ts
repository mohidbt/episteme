import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ||
        "postgresql://episteme:episteme@localhost:5433/episteme",
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
    },
  },
});
