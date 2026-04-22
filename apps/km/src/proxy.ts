import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { decideHostRewrite } from "@/lib/proxy-host";

const PUBLISH_DOMAIN = process.env.EPISTEME_PUBLISH_DOMAIN ?? "epistaime.com";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const decision = decideHostRewrite({
    host,
    pathname: request.nextUrl.pathname,
    publishDomain: PUBLISH_DOMAIN,
  });

  if (decision.kind === "rewrite") {
    const url = request.nextUrl.clone();
    url.pathname = decision.targetPath;
    return NextResponse.rewrite(url);
  }

  const pn = request.nextUrl.pathname;
  if (pn.startsWith("/n/") || pn.startsWith("/settings/")) {
    const session = getSessionCookie(request);
    if (!session) {
      const url = new URL("/sign-in", request.url);
      url.searchParams.set("callbackUrl", pn);
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
