import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/send-email";

/**
 * Post-fetch hook for KM routes that call OpenRouter directly with a key
 * resolved via BYOK-or-env. Fires the notifier ONLY when the failing key
 * came from the named env var (i.e. server fallback, not per-user BYOK).
 * Fire-and-forget: never throws, returns void.
 */
export function checkOpenRouterFallbackResponse(opts: {
  envVar: "EPISTEME_SHARED_LLM_KEY" | "OPENROUTER_API_KEY";
  apiKey: string;
  response: Response;
}): void {
  if (opts.response.ok) return;
  const envValue = process.env[opts.envVar];
  if (!envValue || opts.apiKey !== envValue) return;
  const reason = classifyProviderError(opts.response.status, "");
  if (!reason) {
    // Status alone wasn't enough — peek the body for quota hints (403 case).
    void opts.response
      .clone()
      .text()
      .then((text) => {
        const r2 = classifyProviderError(opts.response.status, text);
        if (r2) {
          void recordAndMaybeAlert({
            provider: "openrouter",
            envVar: opts.envVar,
            reason: r2,
            sampleError: text.slice(0, 1000),
          });
        }
      })
      .catch(() => {});
    return;
  }
  void opts.response
    .clone()
    .text()
    .then((text) => {
      void recordAndMaybeAlert({
        provider: "openrouter",
        envVar: opts.envVar,
        reason,
        sampleError: text.slice(0, 1000),
      });
    })
    .catch(() => {});
}

export type ProviderName =
  | "openrouter"
  | "tavily"
  | "semantic_scholar"
  | "chandra";

export type AlertReason =
  | "key_invalid"
  | "key_exhausted"
  | "key_rate_limited";

const DEDUP_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_THRESHOLD_HITS = 5;

const QUOTA_HINTS = [
  "insufficient_quota",
  "insufficient credit",
  "insufficient credits",
  "payment_required",
  "out of credit",
  "balance",
  "quota exceeded",
];

export function classifyProviderError(
  status: number,
  bodyText: string,
): AlertReason | null {
  const body = (bodyText ?? "").toLowerCase();
  if (status === 401) return "key_invalid";
  if (status === 402) return "key_exhausted";
  if (status === 403 && QUOTA_HINTS.some((h) => body.includes(h))) {
    return "key_exhausted";
  }
  if (status === 429) return "key_rate_limited";
  return null;
}

type AlertRow = {
  id: string;
  hit_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  last_alerted_at: Date | null;
};

function shouldAlert(reason: AlertReason, row: AlertRow): boolean {
  const now = Date.now();
  if (
    row.last_alerted_at &&
    now - new Date(row.last_alerted_at).getTime() < DEDUP_WINDOW_MS
  ) {
    return false;
  }
  if (reason === "key_rate_limited") {
    const firstSeenMs = new Date(row.first_seen_at).getTime();
    if (now - firstSeenMs > RATE_LIMIT_WINDOW_MS) return false;
    if (row.hit_count < RATE_LIMIT_THRESHOLD_HITS) return false;
  }
  return true;
}

async function sendResendEmail(opts: {
  provider: string;
  envVar: string;
  reason: AlertReason;
  row: AlertRow;
  sampleError: string | null;
}): Promise<boolean> {
  const to = (process.env.ALERT_EMAIL_TO ?? "mohidfbutt@gmail.com").trim();
  const subject = `[episteme] ${opts.provider} key ${opts.reason} — ${opts.envVar}`;
  const text = [
    `Provider: ${opts.provider}`,
    `Env var: ${opts.envVar}`,
    `Reason: ${opts.reason}`,
    `Hit count (since first_seen): ${opts.row.hit_count}`,
    `First seen: ${opts.row.first_seen_at}`,
    `Last seen: ${opts.row.last_seen_at}`,
    `Last alerted: ${opts.row.last_alerted_at}`,
    "",
    "Sample error:",
    (opts.sampleError ?? "").trim().slice(0, 1000),
  ].join("\n");

  return sendEmail({ to, subject, text });
}

export async function recordAndMaybeAlert(opts: {
  provider: ProviderName;
  envVar: string;
  reason: AlertReason;
  sampleError?: string | null;
}): Promise<boolean> {
  const sampleError = opts.sampleError ?? null;
  try {
    const upsert = await db.execute(sql`
      INSERT INTO provider_key_alerts (provider, env_var, reason, hit_count, sample_error)
      VALUES (${opts.provider}, ${opts.envVar}, ${opts.reason}, 1, ${sampleError})
      ON CONFLICT (provider, env_var, reason) WHERE cleared_at IS NULL
      DO UPDATE SET
        hit_count = CASE
          WHEN ${opts.reason} = 'key_rate_limited'
               AND provider_key_alerts.first_seen_at < NOW() - INTERVAL '10 minutes'
          THEN 1
          ELSE provider_key_alerts.hit_count + 1
        END,
        first_seen_at = CASE
          WHEN ${opts.reason} = 'key_rate_limited'
               AND provider_key_alerts.first_seen_at < NOW() - INTERVAL '10 minutes'
          THEN NOW()
          ELSE provider_key_alerts.first_seen_at
        END,
        last_seen_at = NOW(),
        sample_error = COALESCE(EXCLUDED.sample_error, provider_key_alerts.sample_error)
      RETURNING id, hit_count, first_seen_at, last_seen_at, last_alerted_at
    `);
    const rows = (upsert as unknown as AlertRow[]) ?? [];
    const row = rows[0];
    if (!row) return false;
    if (!shouldAlert(opts.reason, row)) return false;
    const sent = await sendResendEmail({
      provider: opts.provider,
      envVar: opts.envVar,
      reason: opts.reason,
      row,
      sampleError,
    });
    if (sent) {
      await db.execute(
        sql`UPDATE provider_key_alerts SET last_alerted_at = NOW() WHERE id = ${row.id}`,
      );
    }
    return sent;
  } catch (err) {
    console.error(
      "[key-health] recordAndMaybeAlert failed",
      { provider: opts.provider, envVar: opts.envVar, reason: opts.reason, err },
    );
    return false;
  }
}
