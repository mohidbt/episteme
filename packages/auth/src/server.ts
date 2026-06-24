import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { db } from "@episteme/db";
import * as schema from "@episteme/db/schema";

export interface CreateAuthOpts {
  /**
   * Fires after better-auth creates a new user row when `isAnonymous === true`.
   * Use to seed the demo workspace shown to guests.
   */
  onAnonymousUserCreate?: (userId: string) => Promise<void>;
  /**
   * Fires after better-auth creates a new user row when `isAnonymous === false`
   * — i.e. a real signup (direct or via anon→signup link). Use to seed the
   * minimal welcome workspace (empty library + welcome note). Both signup
   * paths share this hook so direct signups don't land in a libraryless
   * broken state.
   */
  onRealUserCreate?: (userId: string) => Promise<void>;
  /**
   * Fires when an anonymous session is linked to a real account. Runs BEFORE
   * the anonymous plugin deletes the anon user row (so its child rows are
   * still in the DB and can be enumerated for side-effect cleanup like R2
   * object deletion). The user-delete cascade then wipes the DB rows
   * automatically — DO NOT mutate `user_id` here. Pure cleanup hook.
   */
  onAnonymousLink?: (anonUserId: string, newUserId: string) => Promise<void>;
  /**
   * Sends the signup email-verification message. When provided, better-auth's
   * native email-verification flow is enabled: the message is dispatched on
   * sign-up (`sendOnSignUp`) and the user is auto-signed-in after they verify
   * (`autoSignInAfterVerification`). The callback receives the full verify
   * `url` better-auth generates. MUST be non-throwing — a failed send must not
   * fail signup (the user can resend later). Lives KM-side because it depends
   * on the Resend helper in apps/km.
   *
   * Verification is intentionally SOFT: we do NOT set `requireEmailVerification`
   * because anonymous (guest) users have no real email and would be locked out
   * of sign-in / the anon→signup link flow.
   */
  sendVerificationEmail?: (args: {
    user: { id: string; email: string; name?: string };
    url: string;
    token: string;
  }) => Promise<void>;
}

function resolveTrustedOrigins(): string[] {
  const origins = new Set<string>();
  const add = (url: string | undefined) => {
    if (!url) return;
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    origins.add(normalized);
    try {
      const u = new URL(normalized);
      if (u.hostname.startsWith("www.")) {
        origins.add(`${u.protocol}//${u.hostname.slice(4)}${u.port ? `:${u.port}` : ""}`);
      } else {
        origins.add(`${u.protocol}//www.${u.hostname}${u.port ? `:${u.port}` : ""}`);
      }
    } catch {
      // ignore malformed URL
    }
  };
  add(process.env.BETTER_AUTH_URL);
  add(process.env.NEXT_PUBLIC_APP_URL);
  add(process.env.VERCEL_URL);
  add(process.env.VERCEL_BRANCH_URL);
  add(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  origins.add("http://localhost:3000");
  origins.add("http://localhost:3001");
  return Array.from(origins);
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
    trustedOrigins: resolveTrustedOrigins(),
    emailAndPassword: {
      enabled: true,
    },
    ...(opts.sendVerificationEmail
      ? {
          emailVerification: {
            sendVerificationEmail: async ({ user, url, token }) => {
              await opts.sendVerificationEmail!({
                user: {
                  id: user.id,
                  email: user.email,
                  name: (user as { name?: string }).name,
                },
                url,
                token,
              });
            },
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            expiresIn: 3600,
          },
        }
      : {}),
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
            const isAnon = (user as { isAnonymous?: boolean }).isAnonymous === true;
            if (isAnon) {
              if (opts.onAnonymousUserCreate) {
                await opts.onAnonymousUserCreate(user.id);
              }
            } else if (opts.onRealUserCreate) {
              await opts.onRealUserCreate(user.id);
            }
          },
        },
      },
    },
  });
}

export const auth = createAuth();
