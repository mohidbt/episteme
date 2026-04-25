import { createAuth } from "@episteme/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { seedAnonymousUser } from "@/lib/seed-anonymous-user";
import { migrateAnonymousUser } from "@/lib/migrate-anonymous-user";

// Wired auth instance for this app. Anonymous user create → seed library +
// welcome note + sample paper + sample reference. On sign-up while anon, the
// anonymous plugin's onLinkAccount fires → migrate FK rows from anon → new
// user so seeded data follows the user into the authed account. Both hooks
// guarded inside `createAuth` (isAnonymous flag / opts.onAnonymousLink null).
const auth = createAuth({
  onAnonymousUserCreate: seedAnonymousUser,
  onAnonymousLink: migrateAnonymousUser,
});

export const { GET, POST } = toNextJsHandler(auth);
