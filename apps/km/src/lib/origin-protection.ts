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
  const allowed = new Set([
    "https://tryepisteme.com",
    "https://www.tryepisteme.com",
    "https://app.tryepisteme.com",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
  ]);

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

  const publishDomain = process.env.EPISTEME_PUBLISH_DOMAIN?.trim();
  if (publishDomain) {
    addConfiguredOrigin(publishDomain);
    addConfiguredOrigin(`www.${publishDomain}`);
    addConfiguredOrigin(`app.${publishDomain}`);
  }

  // Never trust the shared *.vercel.app namespace. Only the exact deployment
  // hosts supplied by Vercel above are accepted.
  return allowed.has(url.origin);
}
