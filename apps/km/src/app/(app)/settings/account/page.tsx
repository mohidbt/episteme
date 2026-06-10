import Link from "next/link";
import { UserPlus } from "lucide-react";
import { getCurrentSession } from "@/lib/session";
import { AccountForms } from "./AccountForms";
import { SignOutButton } from "./SignOutButton";

export default async function AccountSettingsPage() {
  const session = await getCurrentSession();

  // Anonymous guests have no email or password (better-auth anonymous flow),
  // so the change-password form is nonsense for them. Surface an upgrade CTA
  // instead.
  if (session?.isAnonymous) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <h1 className="font-display text-2xl mb-1">Account</h1>
        <p className="text-sm text-muted-foreground mb-6">
          You are signed in as a guest. Sign up to create credentials, save your
          work across devices, and manage your account.
        </p>
        <Link
          href="/sign-up"
          data-testid="settings-account-anon-signup-cta"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <UserPlus className="size-4" aria-hidden />
          Sign up to save across devices
        </Link>
        <div className="mt-8">
          <SignOutButton />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      <h1 className="font-display text-2xl mb-1">Account</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Manage your sign-in credentials.
      </p>
      <AccountForms />
      <div className="mt-8">
        <SignOutButton />
      </div>
    </div>
  );
}
