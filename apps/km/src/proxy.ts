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

  if (decision.kind === "rewrite") {
    const url = request.nextUrl.clone();
    url.pathname = decision.targetPath;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
