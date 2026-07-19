// Single source of truth for the trusted-host / trusted-origin set derived from
// the publish domain. Both `resolveTrustedOrigins()` (packages/auth server.ts,
// better-auth trustedOrigins) and `isAllowedOrigin()` (apps/km CSRF guard)
// consume this so the two lists cannot drift — the drift between them caused a
// login-origin outage (GSD-148).
//
// Pure module: no db / env-side-effect imports so it is safe for both packages.

const CANONICAL_DOMAIN = "tryepisteme.com";

const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
] as const;

const tripleFor = (domain: string): string[] => [
  `https://${domain}`,
  `https://www.${domain}`,
  `https://app.${domain}`,
];

/**
 * Trusted origins for a publish domain. Emits bare, `www.`, and `app.` on https
 * plus the localhost/127.0.0.1 dev origins.
 *
 * ALWAYS unions the canonical `tryepisteme.com` triple with the configured
 * domain's triple — never replaces it. A custom EPISTEME_PUBLISH_DOMAIN is
 * ADDITIVE, so a misconfigured/unexpected env value can never silently drop the
 * canonical hosts and 403 real logins (GSD-148 codex MAJOR). When the configured
 * domain equals the canonical one, the Set collapses the duplicate triple.
 *
 * `|| CANONICAL_DOMAIN` (NOT `??`): `.env.production` ships
 * EPISTEME_PUBLISH_DOMAIN="" and `??` would let the empty string through,
 * yielding garbage origins like `https://app.` and never trusting the real host.
 */
export function trustedOriginsFor(publishDomain?: string): string[] {
  const domain = publishDomain || CANONICAL_DOMAIN;
  return Array.from(
    new Set<string>([
      ...tripleFor(CANONICAL_DOMAIN),
      ...tripleFor(domain),
      ...DEV_ORIGINS,
    ]),
  );
}
