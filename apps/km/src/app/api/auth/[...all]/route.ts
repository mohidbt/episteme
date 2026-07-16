import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth-wired";

// Anon user create → seed full demo workspace (papers, refs, notes, paperset).
// Real user create (direct signup OR anon→signup link) → seed minimal "My
// Library" + Trash + welcome note. On anon→real link, R2 objects from the
// guest seed are explicitly deleted (DB rows die via user-delete cascade).
// Guest-mode edits intentionally do NOT carry over into the real account.
const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

/**
 * The app's real-user signup policy lives in POST /api/auth/signup-real,
 * which enforces invite redemption and persists the required profile fields.
 *
 * Better Auth also exposes a native POST /sign-up/email endpoint whenever
 * emailAndPassword is enabled. Forwarding that endpoint from this catch-all
 * route would let a caller create a real account without an invite simply by
 * skipping the signup UI. Blocking only the public HTTP endpoint keeps
 * `auth.api.signUpEmail()` available to the trusted signup-real server code.
 */
export async function POST(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/api/auth/sign-up/email")) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return handlers.POST(request);
}
