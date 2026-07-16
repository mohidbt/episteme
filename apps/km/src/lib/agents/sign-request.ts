import crypto from "node:crypto";
import {
  canonicalInternalAuthPayload,
  INTERNAL_AUTH_SIGNATURE_VERSION,
} from "@episteme/auth/internal";

export interface SignInput {
  method: "GET" | "POST";
  path: string;
  body: string;
  userId: string;
  paperId?: string;
  llmKey: string;
  ocrKey?: string;
}

export interface SignedHeaders {
  "X-Inhale-User-Id": string;
  "X-Inhale-Paper-Id"?: string;
  "X-Inhale-LLM-Key": string;
  "X-Inhale-OCR-Key"?: string;
  "X-Inhale-Ts": string;
  "X-Inhale-Sig": string;
  "X-Inhale-Sig-Version": typeof INTERNAL_AUTH_SIGNATURE_VERSION;
}

export function signRequest(input: SignInput): { headers: SignedHeaders; ts: string } {
  const secret = process.env.INHALE_INTERNAL_SECRET;
  if (!secret) throw new Error("INHALE_INTERNAL_SECRET missing");
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto
    .createHmac("sha256", secret)
    .update(
      canonicalInternalAuthPayload({
        ts,
        method: input.method,
        path: input.path,
        userId: input.userId,
        paperId: input.paperId,
        llmKey: input.llmKey,
        ocrKey: input.ocrKey,
        body: input.body,
      }),
    )
    .digest("hex");
  const h: SignedHeaders = {
    "X-Inhale-User-Id": input.userId,
    "X-Inhale-LLM-Key": input.llmKey,
    "X-Inhale-Ts": ts,
    "X-Inhale-Sig": sig,
    "X-Inhale-Sig-Version": INTERNAL_AUTH_SIGNATURE_VERSION,
  };
  if (input.paperId !== undefined) h["X-Inhale-Paper-Id"] = input.paperId;
  if (input.ocrKey !== undefined) h["X-Inhale-OCR-Key"] = input.ocrKey;
  return { headers: h, ts };
}
