import { pgTable, text, timestamp, serial, integer, jsonb } from "drizzle-orm/pg-core";
import { documents } from "./documents";

export const documentOutlines = pgTable("document_outlines", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().unique().references(() => documents.id, { onDelete: "cascade" }),
  outline: jsonb("outline").notNull(),   // Array<{ title: string, pageStart: number, summary: string }>
  concepts: jsonb("concepts"),           // Array<{ term: string, definition: string }>
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});
