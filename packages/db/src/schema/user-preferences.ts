import { pgEnum, pgTable, boolean, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const fontPref = pgEnum("font_pref", ["sans", "serif", "mono"]);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  font: fontPref("font").default("sans").notNull(),
  ruledLines: boolean("ruled_lines").default(false).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
