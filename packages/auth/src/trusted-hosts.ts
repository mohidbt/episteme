// Single source of truth for the trusted-host / trusted-origin set derived from
// the publish domain. Both `resolveTrustedOrigins()` (packages/auth server.ts,
// better-auth trustedOrigins) and `isAllowedOrigin()` (apps/km CSRF guard)
// consume this so the two lists cannot drift — the drift between them caused a
// login-origin outage (GSD-148).
//
// Pure module: no db / env-side-effect imports so it is safe for both packages.

const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
] as const;

/**
 * Trusted origins for a publish domain. Emits bare, `www.`, and `app.` on https
 * plus the localhost/127.0.0.1 dev origins.
 *
 * `|| "tryepisteme.com"` (NOT `??`): `.env.production` ships
 * EPISTEME_PUBLISH_DOMAIN="" and `??` would let the empty string through,
 * yielding garbage origins like `https://app.` and never trusting the real host.
 */
export function trustedOriginsFor(publishDomain?: string): string[] {
  const domain = publishDomain || "tryepisteme.com";
  return [
    `https://${domain}`,
    `https://www.${domain}`,
    `https://app.${domain}`,
    ...DEV_ORIGINS,
  ];
}
