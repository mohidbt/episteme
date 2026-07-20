// Boot-time guard for transactional email. A missing RESEND_API_KEY makes every
// signup verification email silently no-op (send-email.ts) — and because email
// verification is now a HARD gate, that traps new users with no way in. This
// surfaces the misconfiguration loudly at startup so it can never again pass
// unnoticed.
//
// Error-log (not throw) on purpose: throwing here would take the whole app down
// for already-verified users too, which is strictly worse than a loud log the
// deploy pipeline / on-call can act on.
export function assertResendConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) {
    console.error(
      "[boot] RESEND_API_KEY is unset in production — signup verification " +
        "emails will be silently suppressed and new users cannot pass the " +
        "email-verification gate. Set RESEND_API_KEY (and verify the sending " +
        "domain in Resend) in this Vercel env scope.",
    );
  }
}
