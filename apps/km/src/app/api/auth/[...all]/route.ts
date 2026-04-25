import { createAuth } from "@episteme/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { seedAnonymousUser } from "@/lib/seed-anonymous-user";

// Wired auth instance for this app. Anonymous user create → seed library +
// welcome note + sample paper + sample reference. Guarded by `isAnonymous` in
// `createAuth` so email sign-ups don't trigger the seed.
const auth = createAuth({ onAnonymousUserCreate: seedAnonymousUser });

export const { GET, POST } = toNextJsHandler(auth);
