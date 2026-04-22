import { RESERVED } from "./reserved-usernames";

const ALWAYS_PASS = new Set(["www", "app"]);

export type HostDecision =
  | { kind: "rewrite"; subdomain: string; targetPath: string }
  | { kind: "passthrough" };

export function decideHostRewrite(opts: {
  host: string;
  pathname: string;
  publishDomain: string;
}): HostDecision {
  if (!opts.host || !opts.publishDomain) return { kind: "passthrough" };
  if (opts.pathname.startsWith("/pub/")) return { kind: "passthrough" };

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
