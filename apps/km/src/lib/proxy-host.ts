import { RESERVED } from "./reserved-usernames";

const ALWAYS_PASS = new Set(["www", "app"]);

// Root files the marketing domain must keep serving itself (sitemap.ts declares
// https://<publishDomain> canonical and robots.ts advertises its sitemap there),
// so they are never redirected to the app subdomain.
const BARE_DOMAIN_ALLOW = new Set([
  "/robots.txt",
  "/sitemap.xml",
  "/icon.svg",
  "/favicon.ico",
]);

export type HostDecision =
  | { kind: "rewrite"; subdomain: string | null; targetPath: string }
  | { kind: "redirect"; targetHost: string }
  | { kind: "passthrough" };

export function decideHostRewrite(opts: {
  host: string;
  pathname: string;
  publishDomain: string;
}): HostDecision {
  if (!opts.host || !opts.publishDomain) return { kind: "passthrough" };
  if (opts.pathname.startsWith("/pub/")) return { kind: "passthrough" };

  // Bare publish domain (and www) serve the marketing landing at "/" only
  // (and /pub/* handled above). Every other path redirects to the app
  // subdomain, where the application routes (e.g. /sign-up) now live.
  if (opts.host === opts.publishDomain || opts.host === "www." + opts.publishDomain) {
    if (opts.pathname === "/") {
      return { kind: "rewrite", subdomain: null, targetPath: "/landing" };
    }
    if (BARE_DOMAIN_ALLOW.has(opts.pathname)) return { kind: "passthrough" };
    return { kind: "redirect", targetHost: "app." + opts.publishDomain };
  }

  const suffix = "." + opts.publishDomain;
  if (!opts.host.endsWith(suffix)) return { kind: "passthrough" };
  const sub = opts.host.slice(0, opts.host.length - suffix.length);
  if (!sub || sub.includes(".")) return { kind: "passthrough" };
  if (ALWAYS_PASS.has(sub) || RESERVED.has(sub)) return { kind: "passthrough" };

  return {
    kind: "rewrite",
    subdomain: sub,
    targetPath: `/pub/${sub}${opts.pathname}`,
  };
}
