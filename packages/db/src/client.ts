import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

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
const appUrl = process.env.APP_RUNTIME_DATABASE_URL;
const fallbackUrl = process.env.DATABASE_URL;
if (!appUrl && fallbackUrl) {
  console.warn(
    "[@episteme/db] APP_RUNTIME_DATABASE_URL not set — falling back to DATABASE_URL (owner role). B3 cutover incomplete in this environment.",
  );
}
const queryClient = postgres(appUrl ?? fallbackUrl!);

export const db = drizzle({ client: queryClient, schema });
