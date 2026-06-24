// Shared better-auth instance with all our hooks wired.
//
// Two consumers:
//   • app/api/auth/[...all]/route.ts — better-auth's native HTTP handler
//   • lib/signup-real.ts — invite-gated signup wrapper
//
// Both MUST use the same instance, otherwise `signUpEmail` via signup-real
// would not trigger `onRealUserCreate` (no library seeded → broken account).
import { createAuth } from "@episteme/auth";
import { seedAnonymousUser } from "@/lib/seed-anonymous-user";
import { seedRealUser } from "@/lib/seed-real-user";
import { cleanupAnonymousR2 } from "@/lib/cleanup-anonymous-r2";
import { sendVerificationEmailCallback } from "@/lib/verification-callback";

export const auth = createAuth({
  onAnonymousUserCreate: seedAnonymousUser,
  onRealUserCreate: seedRealUser,
  onAnonymousLink: cleanupAnonymousR2,
  // Soft email verification: sent on signup, non-fatal if Resend is down.
  // No `requireEmailVerification` — guests/anon have no real email.
  sendVerificationEmail: sendVerificationEmailCallback,
});
