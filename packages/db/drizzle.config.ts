import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: "../../apps/reader/.env.local" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
