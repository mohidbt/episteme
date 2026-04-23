import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { libraries } from "./libraries";
import { user } from "./auth";

export const TRASH_FOLDER_NAME = "Trash";

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    libraryId: integer("library_id")
      .notNull()
      .references(() => libraries.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    isTrash: boolean("is_trash").default(false).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("folders_library_parent_name_unique").on(
      t.libraryId,
      t.parentId,
      t.name,
    ),
    check(
      "folders_trash_at_root",
      sql`${t.isTrash} = false OR ${t.parentId} IS NULL`,
    ),
    foreignKey({
      name: "folders_parent_fk",
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete("cascade"),
  ],
);
