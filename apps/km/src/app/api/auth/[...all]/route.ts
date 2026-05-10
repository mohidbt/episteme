import { createAuth } from "@episteme/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { seedAnonymousUser } from "@/lib/seed-anonymous-user";
import { seedRealUser } from "@/lib/seed-real-user";
import { cleanupAnonymousR2 } from "@/lib/cleanup-anonymous-r2";

// Anon user create → seed full demo workspace (papers, refs, notes, paperset).
// Real user create (direct signup OR anon→signup link) → seed minimal "My
// Library" + Trash + welcome note. On anon→real link, R2 objects from the
// guest seed are explicitly deleted (DB rows die via user-delete cascade).
// Guest-mode edits intentionally do NOT carry over into the real account.
const auth = createAuth({
  onAnonymousUserCreate: seedAnonymousUser,
  onRealUserCreate: seedRealUser,
  onAnonymousLink: cleanupAnonymousR2,
});

export const { GET, POST } = toNextJsHandler(auth);
