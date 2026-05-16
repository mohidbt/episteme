import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth-wired";

// Anon user create → seed full demo workspace (papers, refs, notes, paperset).
// Real user create (direct signup OR anon→signup link) → seed minimal "My
// Library" + Trash + welcome note. On anon→real link, R2 objects from the
// guest seed are explicitly deleted (DB rows die via user-delete cascade).
// Guest-mode edits intentionally do NOT carry over into the real account.
export const { GET, POST } = toNextJsHandler(auth);
