import { NextRequest, NextResponse } from "next/server";
import { decideHostRewrite } from "@/lib/proxy-host";

const PUBLISH_DOMAIN = process.env.EPISTEME_PUBLISH_DOMAIN ?? "tryepisteme.com";

const BOT_PROBE_RE =
  /^\/(?:wp-admin|wp-login|wp-content|wp-includes)(?:\.|\/|$)|^\/(?:xmlrpc\.php|\.env|\.git(?:\/|$))/i;

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (BOT_PROBE_RE.test(pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  const host = request.headers.get("host") ?? "";
  const decision = decideHostRewrite({
    host,
    pathname,
    publishDomain: PUBLISH_DOMAIN,
  });

  if (decision.kind === "redirect") {
    const url = request.nextUrl.clone();
    url.host = decision.targetHost;
    url.protocol = "https:";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  // Mark the marketing landing so the server layout skips the desktop-only
  // MobileGate there. Always derive the marker from the proxy decision (rewrite
  // of "/" → /landing, or a direct /landing hit on previews) and overwrite any
  // client-supplied value so it can't be spoofed to bypass the gate elsewhere.
  const isLanding =
    (decision.kind === "rewrite" && decision.targetPath === "/landing") ||
    pathname === "/landing";
  const requestHeaders = new Headers(request.headers);
  if (isLanding) requestHeaders.set("x-mk-landing", "1");
  else requestHeaders.delete("x-mk-landing");

  if (decision.kind === "rewrite") {
    const url = request.nextUrl.clone();
    url.pathname = decision.targetPath;
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
