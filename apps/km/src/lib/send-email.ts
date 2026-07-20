// Shared transactional-email sender (Resend). Never throws; returns a result
// describing what happened so callers can log the Resend id on success and a
// loud, diagnosable reason on failure. Falls back to a no-op warn when
// RESEND_API_KEY is unset (same graceful posture as key-health alerts). Reused
// by key-health alerts and signup email verification.
export type SendEmailResult = {
  ok: boolean;
  // Resend message id on success — log this so a future "no email" report is
  // traceable to a concrete send.
  id?: string;
  // Why the send did not succeed: "unset" (no API key), "http_<status>"
  // (Resend rejected), or "threw" (network/JSON error).
  reason?: string;
};

export async function sendEmail(opts: {
  to: string;
  from?: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<SendEmailResult> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) {
    console.warn("[send-email] suppressed — RESEND_API_KEY unset", {
      to: opts.to,
      subject: opts.subject,
    });
    return { ok: false, reason: "unset" };
  }
  const from = (
    opts.from ??
    process.env.ALERT_EMAIL_FROM ??
    "alerts@tryepisteme.com"
  ).trim();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        ...(opts.text ? { text: opts.text } : {}),
        ...(opts.html ? { html: opts.html } : {}),
      }),
    });
    if (!res.ok) {
      console.error("[send-email] resend POST failed", {
        status: res.status,
        to: opts.to,
        subject: opts.subject,
      });
      return { ok: false, reason: `http_${res.status}` };
    }
    const id = await extractResendId(res);
    return { ok: true, id };
  } catch (err) {
    console.error("[send-email] resend POST threw", err);
    return { ok: false, reason: "threw" };
  }
}

// Best-effort parse of Resend's `{ id }` response. Never throws — a missing/
// malformed body still counts as a successful send (Resend already returned 2xx).
async function extractResendId(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { id?: unknown };
    return typeof body?.id === "string" ? body.id : undefined;
  } catch {
    return undefined;
  }
}
