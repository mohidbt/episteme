import { MissingInternalSecretError, verifyInternalAuth } from "@episteme/auth/internal";
import { runDbChecks, runJournalChecks } from "@episteme/db";

export const runtime = "nodejs";

async function handle(request: Request, rawBody = ""): Promise<Response> {
  try {
    const auth = await verifyInternalAuth(request, rawBody);
    if (!auth.ok) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  } catch (error) {
    if (error instanceof MissingInternalSecretError) {
      return Response.json({ error: "internal auth misconfigured" }, { status: 500 });
    }
    throw error;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return Response.json({ ok: false, error: "DATABASE_URL is not configured" }, { status: 500 });
  }

  const journal = runJournalChecks();
  const db = await runDbChecks(databaseUrl);
  const ok = journal.ok && db.ok;

  return Response.json(
    {
      ok,
      timestamp: new Date().toISOString(),
      journal: {
        ok: journal.ok,
        latestTag: journal.latestTag,
        checks: journal.checks,
      },
      db: {
        ok: db.ok,
        fingerprint: db.fingerprint,
        latestAppliedMigration: db.latestAppliedMigration,
        checks: db.checks,
      },
    },
    { status: ok ? 200 : 503 },
  );
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, "");
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  return handle(request, rawBody);
}
