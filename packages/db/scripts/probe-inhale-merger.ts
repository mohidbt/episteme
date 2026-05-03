import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  const orphans = await sql`
    SELECT d.id, d.user_id, d.filename
      FROM documents d
      LEFT JOIN papers p
        ON p.user_id = d.user_id AND p.filename = d.filename
     WHERE p.id IS NULL
  `;
  const ambiguous = await sql`
    SELECT d.id, d.user_id, d.filename, COUNT(p.id) AS paper_matches
      FROM documents d
      JOIN papers p
        ON p.user_id = d.user_id AND p.filename = d.filename
     GROUP BY d.id, d.user_id, d.filename
     HAVING COUNT(p.id) > 1
  `;

  if (orphans.length === 0 && ambiguous.length === 0) {
    console.log("OK: documents ↔ papers join is clean. Migration is safe.");
    process.exit(0);
  }

  console.error("Probe FAILED.");
  if (orphans.length > 0) console.error("Orphans (no papers row):", orphans);
  if (ambiguous.length > 0) console.error("Ambiguous (>1 papers row):", ambiguous);
  process.exit(1);
}

main().finally(() => sql.end());
