import { VerifyEmailClient } from "./VerifyEmailClient";

// better-auth redirects here after a verify-email click: success → no params,
// invalid/expired token → `?error=invalid_token`. Soft flow — verification is
// a nudge, not a gate.
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <VerifyEmailClient error={error ?? null} />;
}
