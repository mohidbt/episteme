import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { libraries } from "./libraries";
import { folders } from "./folders";
import { user } from "./auth";

export const papers = pgTable(
  "papers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    libraryId: integer("library_id").notNull().references(() => libraries.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    folderPath: text("folder_path").default("").notNull(),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    prevFolderId: uuid("prev_folder_id").references(() => folders.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    storageUrl: text("storage_url"),
    title: text("title"),
    authors: text("authors").array(),
    year: integer("year"),
    doi: text("doi"),
    venue: text("venue"),
    addedAt: timestamp("added_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
    chandraStatus: text("chandra_status")
      .$type<"pending" | "running" | "done" | "failed">()
      .notNull()
      .default("pending"),
    chandraCompletedAt: timestamp("chandra_completed_at", { withTimezone: true }),
  },
  (t) => [
    index("papers_library_idx").on(t.libraryId),
    index("papers_folder_path_idx").on(t.libraryId, t.folderPath),
  ],
);
