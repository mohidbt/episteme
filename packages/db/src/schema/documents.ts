import { pgTable, text, timestamp, integer, serial, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const processingStatusEnum = pgEnum("processing_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  filePath: text("file_path").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  pageCount: integer("page_count"),
  processingStatus: processingStatusEnum("processing_status")
    .notNull()
    .default("pending"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
});
