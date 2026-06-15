import Link from "next/link";
import { UserPlus } from "lucide-react";
import { getCurrentSession } from "@/lib/session";
import { ensureUsername } from "@/lib/ensure-username";
import {
  ensureUserReferralCodes,
  listReferralCodesForUser,
  REFERRAL_CODES_PER_USER,
} from "@/lib/referral-codes";
import { ReferralsList } from "./ReferralsList";

export const dynamic = "force-dynamic";

export default async function ReferralsSettingsPage() {
  const session = await getCurrentSession();

  // Anonymous guests don't own referral codes — surface the same upgrade
  // CTA the account page uses for consistency.
  if (!session || session.isAnonymous) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <h1 className="font-display text-2xl mb-1">Referrals</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Sign up to claim your personal referral codes and invite people to
          Episteme.
        </p>
        <Link
          href="/sign-up"
          data-testid="settings-referrals-anon-signup-cta"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <UserPlus className="size-4" aria-hidden />
          Sign up to get your invite codes
        </Link>
      </div>
    );
  }

  // GSD-46: defensively backfill a username for legacy / non-wizard accounts
  // so this page never dead-ends. /settings/account has no username editor,
  // so the previous "Pick a username in account settings" CTA pointed
  // nowhere. ensureUsername derives one from the user's name/email + claims
  // it under the unique index with collision retry.
  const username = await ensureUsername(session.userId);
  if (!username) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <h1 className="font-display text-2xl mb-1">Referrals</h1>
        <p className="text-sm text-muted-foreground">
          Your invite codes aren&apos;t ready yet. Refresh in a moment — if
          this keeps happening, ping support.
        </p>
      </div>
    );
  }

  await ensureUserReferralCodes(session.userId, username);

  const codes = await listReferralCodesForUser(session.userId);
  const remaining = codes.filter((c) => !c.consumedByUserId).length;

  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      <h1 className="font-display text-2xl mb-1">Referrals</h1>
      <p className="text-sm text-muted-foreground mb-8">
        You have {REFERRAL_CODES_PER_USER} invite codes. Share them with people
        you want to bring to Episteme.{" "}
        <span data-testid="referrals-remaining">{remaining} remaining</span>.
      </p>
      <ReferralsList codes={codes} />
    </div>
  );
}
