import { pgTable, uuid, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";
import { libraries } from "./libraries";
import { user } from "./auth";
import { folders } from "./folders";

export const papersets = pgTable("papersets", {
  id: uuid("id").defaultRandom().primaryKey(),
  libraryId: integer("library_id").notNull().references(() => libraries.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
  prevFolderId: uuid("prev_folder_id").references(() => folders.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  columns: jsonb("columns").$type<Array<{ name: string; description: string }>>().notNull().default([]),
  rowRefs: jsonb("row_refs").$type<Array<{ paper_id: string }>>().notNull().default([]),
  cellGrounding: jsonb("cell_grounding").$type<Record<string, Record<string, { paper_id: string; block_ids: string[] }>>>().notNull().default({}),
  runningCells: jsonb("running_cells").$type<Array<{ row: number; col: string }>>().notNull().default([]),
  content: text("content").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type Paperset = typeof papersets.$inferSelect;
export type PapersetInsert = typeof papersets.$inferInsert;
