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
  const allowed = [
    "tryepisteme.com",
    "www.tryepisteme.com",
    "app.tryepisteme.com",
    "localhost:3000",
    "127.0.0.1:3000",
  ];
  if (allowed.includes(url.host)) return true;
  if (url.host.endsWith(".vercel.app")) return true;
  return false;
}
