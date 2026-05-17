// Real-user signup endpoint — wraps better-auth signUpEmail with invite-gate
// + signup-extras persistence. Anonymous signup still goes through
// /api/auth/[...all] (better-auth's native handler).
import { isAllowedOrigin } from "@/lib/origin-protection";
import { signupRealUser } from "@/lib/signup-real";

const ERROR_STATUS: Record<string, number> = {
  validation: 400,
  invite_invalid: 400,
  email_taken: 409,
  username_taken: 409,
  internal: 500,
};

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!isAllowedOrigin(origin, host)) {
    return Response.json({ error: "forbidden_origin" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const result = await signupRealUser(body);
  if (!result.ok) {
    const status = ERROR_STATUS[result.error] ?? 400;
    return Response.json(
      {
        error: result.error,
        ...(result.issues ? { issues: result.issues } : {}),
      },
      { status },
    );
  }

  // Pass through better-auth's set-cookie so the client lands signed-in.
  const respHeaders = new Headers({ "content-type": "application/json" });
  const setCookie = result.headers.get("set-cookie");
  if (setCookie) respHeaders.set("set-cookie", setCookie);
  return new Response(JSON.stringify({ ok: true, userId: result.userId }), {
    status: 200,
    headers: respHeaders,
  });
}
