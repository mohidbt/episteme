import { sendEmail } from "./send-email";
import { buildVerificationEmail } from "./verification-email";

// Where the user lands after clicking the verify link. better-auth redirects
// here on success, or here with `?error=...` on an invalid/expired token.
const VERIFY_CALLBACK_PATH = "/verify-email";

// better-auth's `emailVerification.sendVerificationEmail` callback (KM side).
// NON-FATAL: any failure is swallowed so a Resend outage never fails signup —
// the user can resend from /verify-email later.
export async function sendVerificationEmailCallback(args: {
  user: { id: string; email: string; name?: string };
  url: string;
  token: string;
}): Promise<void> {
  try {
    const url = appendCallbackURL(args.url, VERIFY_CALLBACK_PATH);
    const { subject, text, html } = buildVerificationEmail({
      url,
      firstname: args.user.name,
    });
    const res = await sendEmail({ to: args.user.email, subject, text, html });
    if (res.ok) {
      // Success — log the Resend id so a future "no email" report is traceable
      // to a concrete delivered send.
      console.info("[verification-callback] sent", {
        to: args.user.email,
        resendId: res.id,
      });
    } else {
      // Loud failure — this is the exact case that silently trapped users
      // (e.g. reason "unset" = RESEND_API_KEY missing in this env scope).
      console.error("[verification-callback] send did not deliver", {
        to: args.user.email,
        reason: res.reason,
      });
    }
  } catch (err) {
    console.error("[verification-callback] send failed (non-fatal)", err);
  }
}

function appendCallbackURL(rawUrl: string, callbackPath: string): string {
  try {
    const u = new URL(rawUrl);
    u.searchParams.set("callbackURL", callbackPath);
    return u.toString();
  } catch {
    // Fallback for a non-absolute url — append manually.
    const sep = rawUrl.includes("?") ? "&" : "?";
    return `${rawUrl}${sep}callbackURL=${encodeURIComponent(callbackPath)}`;
  }
}
