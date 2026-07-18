import { toast } from "sonner";

/**
 * Guest write-blocked routes (see `require-non-guest.ts`) return
 * `403 { error: "guest_forbidden" }`. That code is ONLY ever returned to
 * anonymous sessions — the server gates on `session.isAnonymous`, so a
 * signed-in user can never receive it. The error code is therefore a reliable
 * guest signal on its own; the friendly message can never leak to authed users.
 *
 * Call this from a write call site's error branch BEFORE showing the generic
 * error. Returns `true` when it handled (showed) the guest message, so the
 * caller can early-return; returns `false` otherwise so normal error handling
 * proceeds.
 */
export function maybeShowGuestError(
  res: Response,
  body: { error?: string } | null | undefined,
): boolean {
  if (res.status !== 403 || body?.error !== "guest_forbidden") return false;
  toast.error("You're in guest mode", {
    description: "Sign up to edit, delete, or add files.",
    action: {
      label: "Sign up",
      onClick: () => {
        if (typeof window !== "undefined") {
          window.location.href = "/sign-up";
        }
      },
    },
  });
  return true;
}
