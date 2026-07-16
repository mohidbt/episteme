import { createHmac } from "node:crypto";
import {
  canonicalInternalAuthPayload,
  INTERNAL_AUTH_SIGNATURE_VERSION,
} from "@episteme/auth/internal";

export function internalAuthTestHeaders(options: {
  secret: string;
  userId: string;
  method: string;
  path: string;
  body?: string;
  paperId?: string;
  llmKey?: string;
  ocrKey?: string;
  ts?: string;
}): Record<string, string> {
  const ts = options.ts ?? String(Math.floor(Date.now() / 1000));
  const body = options.body ?? "";
  const paperId = options.paperId ?? "";
  const llmKey = options.llmKey ?? "";
  const ocrKey = options.ocrKey ?? "";
  const signature = createHmac("sha256", options.secret)
    .update(
      canonicalInternalAuthPayload({
        ts,
        method: options.method,
        path: options.path,
        userId: options.userId,
        paperId,
        llmKey,
        ocrKey,
        body,
      }),
    )
    .digest("hex");

  return {
    "X-Inhale-User-Id": options.userId,
    ...(paperId ? { "X-Inhale-Paper-Id": paperId } : {}),
    ...(llmKey ? { "X-Inhale-LLM-Key": llmKey } : {}),
    ...(ocrKey ? { "X-Inhale-OCR-Key": ocrKey } : {}),
    "X-Inhale-Ts": ts,
    "X-Inhale-Sig": signature,
    "X-Inhale-Sig-Version": INTERNAL_AUTH_SIGNATURE_VERSION,
  };
}
