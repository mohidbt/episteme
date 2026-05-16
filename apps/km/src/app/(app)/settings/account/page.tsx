import { AccountForms } from "./AccountForms";

export default function AccountSettingsPage() {
  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      <h1 className="font-display text-2xl mb-1">Account</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Manage your sign-in credentials.
      </p>
      <AccountForms />
    </div>
  );
}
