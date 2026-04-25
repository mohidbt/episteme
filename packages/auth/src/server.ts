import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { db } from "@episteme/db";
import * as schema from "@episteme/db/schema";

export interface CreateAuthOpts {
  /**
   * Fires after better-auth creates a new user row when `isAnonymous === true`.
   * Use to seed app-level state (libraries, demo content, etc.). Kept as an
   * injected callback so `@episteme/auth` stays decoupled from app concerns
   * (storage, crossref, etc.).
   */
  onAnonymousUserCreate?: (userId: string) => Promise<void>;
  /**
   * Fires when an anonymous session signs up / signs in for real and the
   * better-auth anonymous plugin links the two accounts. Implementations
   * should migrate per-user FK rows from `anonUserId` → `newUserId` so the
   * anon user's seeded data follows them into the authed account. After this
   * callback returns, the plugin deletes the anonymous user row.
   */
  onAnonymousLink?: (anonUserId: string, newUserId: string) => Promise<void>;
}

export function createAuth(opts: CreateAuthOpts = {}) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
    },
    plugins: [
      anonymous({
        onLinkAccount: opts.onAnonymousLink
          ? async ({ anonymousUser, newUser }) => {
              await opts.onAnonymousLink!(
                anonymousUser.user.id,
                newUser.user.id,
              );
            }
          : undefined,
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            if (
              opts.onAnonymousUserCreate &&
              (user as { isAnonymous?: boolean }).isAnonymous === true
            ) {
              await opts.onAnonymousUserCreate(user.id);
            }
          },
        },
      },
    },
  });
}

export const auth = createAuth();
