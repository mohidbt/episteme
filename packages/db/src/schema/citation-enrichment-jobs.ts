import {
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { papers } from "./papers";

export const citationEnrichmentJobStatusEnum = pgEnum("citation_enrichment_job_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const citationEnrichmentJobs = pgTable(
  "citation_enrichment_jobs",
  {
    paperId: uuid("paper_id")
      .primaryKey()
      .references(() => papers.id, { onDelete: "cascade" }),
    status: citationEnrichmentJobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    totalRefs: integer("total_refs").notNull().default(0),
    enrichedRefs: integer("enriched_refs").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("citation_enrichment_jobs_paper_id_unique").on(table.paperId),
    check("citation_enrichment_jobs_attempts_nonnegative", sql`${table.attempts} >= 0`),
    check(
      "citation_enrichment_jobs_totals_nonnegative",
      sql`${table.totalRefs} >= 0 AND ${table.enrichedRefs} >= 0`,
    ),
  ],
);
