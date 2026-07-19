import { headers } from "next/headers";
import { auth } from "@episteme/auth";
import { VerifyEmailClient } from "./VerifyEmailClient";

// Reached two ways:
// - better-auth redirects here after a verify-email click (success → no params,
//   invalid/expired token → `?error=invalid_token`).
// - GSD-142 hard-block gate redirects an unverified real user here.
// We read the session so the client can show the right state: verified success
// vs "check your inbox" pending (prefilled resend) vs expired-link resend.
// NOT gated with requireVerifiedSession — that would redirect-loop.
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user as
    | { email?: string; emailVerified?: boolean }
    | undefined;
  return (
    <VerifyEmailClient
      error={error ?? null}
      verified={Boolean(user?.emailVerified)}
      email={user?.email ?? null}
    />
  );
}
