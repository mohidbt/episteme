import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, customType, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { libraries } from "./libraries";
import { folders } from "./folders";
import { user } from "./auth";

const bytea = customType<{ data: Uint8Array; notNull: false }>({
  dataType() { return "bytea"; },
});

// Minimal ProseMirror JSON shape. Kept local to avoid coupling @episteme/db to tiptap.
// Mirrors the relevant shape of `JSONContent` from @tiptap/core.
export type ProseMirrorJSON = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorJSON[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
  [key: string]: unknown;
};

export const noteTypeEnum = pgEnum("note_type", ["md", "latex", "pdf-ref"]);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    libraryId: integer("library_id").notNull().references(() => libraries.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    folderPath: text("folder_path").default("").notNull(),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    prevFolderId: uuid("prev_folder_id").references(() => folders.id, { onDelete: "set null" }),
    filename: text("filename"),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    contentMd: text("content_md").default("").notNull(),
    contentJson: jsonb("content_json").$type<ProseMirrorJSON>(),
    yjsState: bytea("yjs_state"),
    noteType: noteTypeEnum("note_type").default("md").notNull(),
    isPublic: boolean("is_public").default(false).notNull(),
    publicSlug: text("public_slug"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("notes_user_slug_unique").on(t.userId, t.slug),
    uniqueIndex("notes_user_public_slug_unique").on(t.userId, t.publicSlug).where(sql`public_slug IS NOT NULL`),
    index("notes_library_folder_idx").on(t.libraryId, t.folderPath),
  ],
);
