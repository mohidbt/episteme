import { MissingInternalSecretError, verifyInternalAuth } from "@episteme/auth/internal";
import { runCitationEnrichmentBatch } from "@/lib/citations/enrichment-jobs";

export const runtime = "nodejs";

function checkVercelCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return false;
  if (request.method === "GET") {
    return request.headers.get("x-vercel-cron") !== null;
  }
  return true;
}

async function handle(request: Request, rawBody: string): Promise<Response> {
  if (!checkVercelCron(request)) {
    try {
      const auth = await verifyInternalAuth(request, rawBody);
      if (!auth.ok) return Response.json({ error: "unauthorized" }, { status: 401 });
    } catch (error) {
      if (error instanceof MissingInternalSecretError) {
        return Response.json({ error: "internal auth misconfigured" }, { status: 500 });
      }
      throw error;
    }
  }

  const result = await runCitationEnrichmentBatch();
  return Response.json(result);
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  return handle(request, rawBody);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, "");
}
