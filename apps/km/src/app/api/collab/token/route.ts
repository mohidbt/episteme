import { SignJWT } from "jose";
import { auth } from "@episteme/auth";

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const secret = new TextEncoder().encode(process.env.BETTER_AUTH_SECRET);
  const token = await new SignJWT({ userId: session.user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(secret);

  return Response.json({ token });
}
