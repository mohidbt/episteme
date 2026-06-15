import { RESERVED } from "./reserved-usernames";

export { RESERVED };

export function isReservedUsername(name: string): boolean {
  return RESERVED.has(name.toLowerCase());
}

export function isValidUsername(name: string): boolean {
  return /^[a-z0-9-]{3,30}$/.test(name) && !isReservedUsername(name);
}

/**
 * Best-effort deterministic username derivation. Used as a defensive fallback
 * for accounts that never got a username set (legacy / direct-better-auth
 * signups) so the referrals page can still mint codes for them.
 *
 * Strategy: prefer name slug, fall back to email local-part, finally hash the
 * userId tail. Caller is responsible for collision retry — see
 * `claimAvailableUsername`.
 */
export function deriveUsernameBase(
  seed: { name?: string | null; email?: string | null; userId: string },
): string {
  const fromName = slugCandidate(seed.name);
  if (fromName) return fromName;
  const fromEmail = slugCandidate(seed.email?.split("@")[0]);
  if (fromEmail) return fromEmail;
  // userIds are random text — strip non-alphanumerics + take suffix.
  const cleaned = seed.userId.toLowerCase().replace(/[^a-z0-9]/g, "");
  const tail = cleaned.slice(-8) || "user";
  return `user-${tail}`.slice(0, 30);
}

function slugCandidate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const slug = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  if (slug.length < 3) return null;
  if (isReservedUsername(slug)) return null;
  return slug;
}
