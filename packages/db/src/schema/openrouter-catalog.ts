import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const openrouterCatalog = pgTable("openrouter_catalog", {
  modelId: text("model_id").primaryKey(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});
