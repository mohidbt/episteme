import { pgTable, uuid, text, timestamp, integer, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { libraries } from "./libraries";
import { folders } from "./folders";
import { papers } from "./papers";
import { user } from "./auth";

export const references_ = pgTable(
  "references",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    libraryId: integer("library_id").notNull().references(() => libraries.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    folderPath: text("folder_path").default("").notNull(),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    prevFolderId: uuid("prev_folder_id").references(() => folders.id, { onDelete: "set null" }),
    citationKey: text("citation_key").notNull(),
    cslJson: jsonb("csl_json"),
    paperId: uuid("paper_id").references(() => papers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("references_library_key_unique").on(t.libraryId, t.citationKey),
    index("references_library_folder_idx").on(t.libraryId, t.folderPath),
  ],
);
