import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ivfflat.probes defaults to 1. With our `lists=100` index on
// document_chunks.embedding, per-document ANN searches (~30 chunks)
// routinely hit empty lists and return zero rows. Bump probes to 10
// so recall is acceptable for small per-document subsets.
// See: https://github.com/pgvector/pgvector#query-options
const queryClient = postgres(process.env.DATABASE_URL!, {
  connection: {
    options: "-c ivfflat.probes=10",
  },
});

export const db = drizzle({ client: queryClient, schema });
