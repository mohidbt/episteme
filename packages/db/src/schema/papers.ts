import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { libraries } from "./libraries";
import { user } from "./auth";

export const papers = pgTable(
  "papers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    libraryId: integer("library_id").notNull().references(() => libraries.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    folderPath: text("folder_path").default("").notNull(),
    filename: text("filename").notNull(),
    storageUrl: text("storage_url"),
    title: text("title"),
    authors: text("authors").array(),
    year: integer("year"),
    doi: text("doi"),
    venue: text("venue"),
    addedAt: timestamp("added_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("papers_library_idx").on(t.libraryId),
    index("papers_folder_path_idx").on(t.libraryId, t.folderPath),
  ],
);
