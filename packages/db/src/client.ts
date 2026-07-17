import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { resolveAppDatabaseUrl } from "./database-url";

// NOTE: ivfflat.probes defaults to 1. With our `lists=100` index on
// document_chunks.embedding, per-document ANN searches (~30 chunks)
// can hit empty lists and miss rows. We previously set
// `options: "-c ivfflat.probes=10"` here, but Neon's pooled connection
// rejects unknown startup parameters and fails ALL queries (incl. Better
// Auth sessions). If a TS caller adds an ANN query, set probes per-statement:
//   await db.transaction(async (tx) => {
//     await tx.execute(sql`SET LOCAL ivfflat.probes = 10`);
//     ...ann query...
//   });
// Today no TS code issues ANN queries (Python agents-svc uses its own conn).

type DrizzleClient = ReturnType<typeof createClient>;

function createClient() {
  // Resolution is deferred to first access (not module load) so that
  // `next build` can import route modules under NODE_ENV=production without
  // requiring APP_RUNTIME_DATABASE_URL at build time. The fail-closed guard in
  // resolveAppDatabaseUrl still throws here on the first real DB access.
  const { url: databaseUrl, usedFallback } = resolveAppDatabaseUrl();
  if (usedFallback) {
    console.warn(
      "[@episteme/db] APP_RUNTIME_DATABASE_URL not set — using DATABASE_URL outside production only.",
    );
  }
  const queryClient = postgres(databaseUrl);
  return drizzle({ client: queryClient, schema });
}

// Memoized singleton — created once, on first property access via the Proxy.
let client: DrizzleClient | undefined;
function getClient(): DrizzleClient {
  if (!client) client = createClient();
  return client;
}

// Lazy Proxy preserves the exact drizzle API (db.select/insert/update/delete/
// execute/transaction/...) and its types, so zero callers change. Every
// property read forwards to the singleton, constructing it on first touch.
export const db = new Proxy({} as DrizzleClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
}) as DrizzleClient;
