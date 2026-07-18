import Link from "next/link";
import { eq } from "drizzle-orm";
import { UserPlus } from "lucide-react";
import { db } from "@/lib/db";
import { user as userTable } from "@episteme/db/schema";
import { getCurrentSession, requireVerifiedSession } from "@/lib/session";
import {
  ensureUserReferralCodes,
  listReferralCodesForUser,
  REFERRAL_CODES_PER_USER,
} from "@/lib/referral-codes";
import { ReferralsList } from "./ReferralsList";

export const dynamic = "force-dynamic";

export default async function ReferralsSettingsPage() {
  const session = await getCurrentSession();

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

  // GSD-142: real (non-anonymous) users past the anon CTA branch above must be
  // email-verified before we run any protected DB read. requireVerifiedSession
  // reuses the cached session, so this adds no extra auth round-trip.
  await requireVerifiedSession();

  const [me] = await db
    .select({ username: userTable.username })
    .from(userTable)
    .where(eq(userTable.id, session.userId))
    .limit(1);

  if (!me?.username) {
    throw new Error(
      `[referrals] user ${session.userId} has no username — signup wizard should always set one`,
    );
  }

  await ensureUserReferralCodes(session.userId, me.username);

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
