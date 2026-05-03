import { pgTable, timestamp, serial, uuid, jsonb } from "drizzle-orm/pg-core";
import { papers } from "./papers";

export const documentOutlines = pgTable("document_outlines", {
  id: serial("id").primaryKey(),
  paperId: uuid("paper_id").notNull().unique().references(() => papers.id, { onDelete: "cascade" }),
  outline: jsonb("outline").notNull(),   // Array<{ title: string, pageStart: number, summary: string }>
  concepts: jsonb("concepts"),           // Array<{ term: string, definition: string }>
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});
