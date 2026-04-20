import { config } from "dotenv";
config({ path: ".env.local" });
import crypto from "crypto";
import postgres from "postgres";
import { decrypt } from "@episteme/auth";

const DOC_ID = Number(process.argv[2]);
if (!DOC_ID) {
  console.error("usage: tsx scripts/reseg-doc.ts <documentId>");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!);
const AGENTS_URL = process.env.AGENTS_URL || "http://localhost:8000";
const SECRET = process.env.INHALE_INTERNAL_SECRET!;

async function main() {
  const [doc] = await sql<{ id: number; user_id: string; file_path: string }[]>`
    SELECT id, user_id, file_path FROM documents WHERE id = ${DOC_ID}
  `;
  if (!doc) throw new Error(`doc ${DOC_ID} not found`);

  const [key] = await sql<{ encrypted_key: string }[]>`
    SELECT encrypted_key FROM user_api_keys
    WHERE user_id = ${doc.user_id} AND provider_type = 'ocr' AND provider_name = 'chandra'
  `;
  if (!key) throw new Error(`no chandra key for user ${doc.user_id}`);
  const chandraKey = decrypt(key.encrypted_key);

  const [llmRow] = await sql<{ encrypted_key: string }[]>`
    SELECT encrypted_key FROM user_api_keys
    WHERE user_id = ${doc.user_id} AND provider_type = 'llm' LIMIT 1
  `;
  const llmKey = llmRow ? decrypt(llmRow.encrypted_key) : "stub";

  await sql`DELETE FROM document_segments WHERE document_id = ${DOC_ID}`;
  console.log(`cleared existing segments for doc ${DOC_ID}`);

  const body = JSON.stringify({ document_id: doc.id, file_path: doc.file_path });
  const path = "/agents/chandra-segments";
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(ts + "POST" + path + body)
    .digest("hex");

  const res = await fetch(`${AGENTS_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Inhale-User-Id": doc.user_id,
      "X-Inhale-Document-Id": String(doc.id),
      "X-Inhale-Llm-Key": llmKey,
      "X-Inhale-OCR-Key": chandraKey,
      "X-Inhale-Ts": ts,
      "X-Inhale-Sig": sig,
    },
    body,
  });
  const text = await res.text();
  console.log(`agents response ${res.status}: ${text}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
