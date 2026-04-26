import { pgTable, uuid, text, timestamp, integer, bigint, index } from "drizzle-orm/pg-core";
import { libraries } from "./libraries";
import { folders } from "./folders";
import { user } from "./auth";

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    libraryId: integer("library_id").notNull().references(() => libraries.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    storageUrl: text("storage_url"),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    index("assets_library_idx").on(t.libraryId),
    index("assets_library_folder_idx").on(t.libraryId, t.folderId),
  ],
);
