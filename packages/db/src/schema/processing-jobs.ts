import { pgTable, text, timestamp, serial, integer, pgEnum } from "drizzle-orm/pg-core";
import { documents } from "./documents";

export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "completed", "failed"]);
export const jobTypeEnum = pgEnum("job_type", ["ocr", "chunking", "embedding", "outline", "concepts"]);

export const processingJobs = pgTable("processing_jobs", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  jobType: jobTypeEnum("job_type").notNull(),
  status: jobStatusEnum("status").notNull().default("queued"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
