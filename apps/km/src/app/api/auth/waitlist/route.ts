import { isAllowedOrigin } from "@/lib/origin-protection";
import { saveSignupWaitlistEntry } from "@/lib/signup-real";

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!isAllowedOrigin(origin, host)) {
    return Response.json({ error: "forbidden_origin" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const result = await saveSignupWaitlistEntry(body);
  if (!result.ok) {
    const status = result.error === "internal" ? 500 : 400;
    return Response.json(
      {
        error: result.error,
        ...(result.issues ? { issues: result.issues } : {}),
      },
      { status },
    );
  }

  return Response.json({ ok: true });
}
