import { toast } from "sonner";

/**
 * Show a toast prompting the guest (anonymous) user to sign in before
 * uploading. Used by every upload entry point so the gating UX is consistent.
 *
 * Anonymous users can edit their seeded library in-session, but PDF/asset
 * uploads are gated behind sign-in.
 */
export function showSignInToUpload(): void {
  toast.error("Sign in to upload files", {
    description:
      "Guest sessions can read and edit, but uploads need a saved account.",
    action: {
      label: "Sign in",
      onClick: () => {
        if (typeof window !== "undefined") {
          window.location.href = "/sign-in";
        }
      },
    },
  });
}
