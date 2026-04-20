import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const agentModelPreferenceEnum = pgEnum("agent_model_preference", ["haiku", "sonnet", "opus"]);

export const agentConfigs = pgTable("agent_configs", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  enabledSkills: text("enabled_skills").array().default([]).notNull(),
  attachedMcps: jsonb("attached_mcps").default([]).notNull(),
  modelPreference: agentModelPreferenceEnum("model_preference").default("sonnet").notNull(),
  approvalRules: jsonb("approval_rules").default({}).notNull(),
  skillsMd: text("skills_md").default("").notNull(),
  memoryMd: text("memory_md").default("").notNull(),
  settingsJson: jsonb("settings_json").default({}).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
