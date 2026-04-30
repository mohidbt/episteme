import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const agentConfigs = pgTable("agent_configs", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  enabledSkills: text("enabled_skills").array().default([]).notNull(),
  attachedMcps: jsonb("attached_mcps").default([]).notNull(),
  modelPreference: text("model_preference").default("google/gemma-4-26b-a4b-it").notNull(),
  approvalRules: jsonb("approval_rules").default({}).notNull(),
  skillsMd: text("skills_md").default("").notNull(),
  memoryMd: text("memory_md").default("").notNull(),
  settingsJson: jsonb("settings_json").default({}).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
