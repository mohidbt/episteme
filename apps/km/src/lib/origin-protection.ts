import { trustedOriginsFor } from "@episteme/auth/trusted-hosts";

// Allowlist origins — production + previews + local dev. Cross-origin POSTs
// without a matching Origin header are rejected to prevent CSRF on custom auth
// routes that run outside better-auth's native handler.
export function isAllowedOrigin(origin: string | null, host: string | null): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (host && url.host === host) return true;

  // Publish-domain-derived hosts (bare + www + app.<domain> + localhost/127 dev)
  // come from the single shared source of truth so this list can never drift
  // from better-auth's resolveTrustedOrigins() — that drift caused a login-origin
  // outage (GSD-148). The empty-string `.env.production` fallback lives inside
  // trustedOriginsFor().
  //
  // Behavioral note vs. the old hardcoded list: a custom EPISTEME_PUBLISH_DOMAIN
  // now yields ONLY that domain's triple — it no longer *also* additively trusts
  // tryepisteme.com. Intentional tightening (a self-host/fork with its own domain
  // shouldn't trust the canonical domain) and prod-safe: prod ships "" or
  // "tryepisteme.com", both of which resolve to the same tryepisteme triple.
  const allowed = new Set(trustedOriginsFor(process.env.EPISTEME_PUBLISH_DOMAIN));

  const addConfiguredOrigin = (raw: string | undefined) => {
    if (!raw) return;
    try {
      const configured = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      allowed.add(configured.origin);
    } catch {
      // Invalid deployment configuration must not broaden the allowlist.
    }
  };
  addConfiguredOrigin(process.env.BETTER_AUTH_URL);
  addConfiguredOrigin(process.env.NEXT_PUBLIC_APP_URL);
  addConfiguredOrigin(process.env.VERCEL_URL);
  addConfiguredOrigin(process.env.VERCEL_BRANCH_URL);
  addConfiguredOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL);

  // Never trust the shared *.vercel.app namespace. Only the exact deployment
  // hosts supplied by Vercel above are accepted.
  return allowed.has(url.origin);
}
