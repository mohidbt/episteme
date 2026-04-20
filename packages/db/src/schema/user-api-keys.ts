import { pgTable, text, timestamp, serial, boolean, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const providerTypeEnum = pgEnum("provider_type", ["llm", "voice", "ocr", "references"]);

export const storageModeEnum = pgEnum("storage_mode", ["cloud", "browser_only"]);

export const userApiKeys = pgTable("user_api_keys", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  providerType: providerTypeEnum("provider_type").notNull(),
  providerName: text("provider_name").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  keyPreview: text("key_preview").notNull(),
  isValid: boolean("is_valid"),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  storageMode: storageModeEnum("storage_mode").notNull().default("cloud"),
  preferences: jsonb("preferences"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
