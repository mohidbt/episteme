import crypto from "node:crypto";

export interface SignInput {
  method: "GET" | "POST";
  path: string;
  body: string;
  userId: string;
  documentId?: number;
  llmKey: string;
  /** Not included in HMAC payload — same treatment as llmKey (replay risk bounded by FRESHNESS_SECONDS=60). */
  ocrKey?: string;
}

export interface SignedHeaders {
  "X-Inhale-User-Id": string;
  "X-Inhale-Document-Id"?: string;
  "X-Inhale-LLM-Key": string;
  "X-Inhale-OCR-Key"?: string;
  "X-Inhale-Ts": string;
  "X-Inhale-Sig": string;
}

export function signRequest(input: SignInput): { headers: SignedHeaders; ts: string } {
  const secret = process.env.INHALE_INTERNAL_SECRET;
  if (!secret) throw new Error("INHALE_INTERNAL_SECRET missing");
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto
    .createHmac("sha256", secret)
    .update(ts + input.method + input.path + input.body)
    .digest("hex");
  const h: SignedHeaders = {
    "X-Inhale-User-Id": input.userId,
    "X-Inhale-LLM-Key": input.llmKey,
    "X-Inhale-Ts": ts,
    "X-Inhale-Sig": sig,
  };
  if (input.documentId !== undefined) h["X-Inhale-Document-Id"] = String(input.documentId);
  if (input.ocrKey !== undefined) h["X-Inhale-OCR-Key"] = input.ocrKey;
  return { headers: h, ts };
}
