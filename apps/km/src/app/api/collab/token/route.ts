import { auth } from "@episteme/auth";
import { mintCollabToken } from "@/lib/collab-token";

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await mintCollabToken(session.user.id);
  return Response.json({ token });
}
