import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const userSignupProfiles = pgTable(
  "user_signup_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    studentLevel: text("student_level"),
    jobRole: text("job_role"),
    industry: text("industry"),
    personaOther: text("persona_other"),
    university: text("university"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "user_signup_profiles_student_level_check",
      sql`${t.studentLevel} IS NULL OR ${t.studentLevel} IN ('Bachelor', 'Master', 'PhD')`,
    ),
  ],
);

export const signupWaitlist = pgTable(
  "signup_waitlist",
  {
    email: text("email").primaryKey(),
    firstname: text("firstname").notNull(),
    username: text("username").notNull(),
    userType: text("user_type").notNull(),
    pokemon: text("pokemon").notNull(),
    studentLevel: text("student_level"),
    jobRole: text("job_role"),
    industry: text("industry"),
    personaOther: text("persona_other"),
    university: text("university"),
    attemptedInviteCode: text("attempted_invite_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "signup_waitlist_user_type_check",
      sql`${t.userType} IN ('student', 'researcher', 'industry', 'other')`,
    ),
    check(
      "signup_waitlist_pokemon_check",
      sql`${t.pokemon} IN ('charmander', 'squirtle', 'bulbasaur')`,
    ),
    check(
      "signup_waitlist_student_level_check",
      sql`${t.studentLevel} IS NULL OR ${t.studentLevel} IN ('Bachelor', 'Master', 'PhD')`,
    ),
  ],
);
