// Shared transactional-email sender (Resend). Never throws; returns whether
// the send succeeded. Falls back to a no-op warn when RESEND_API_KEY is unset
// (same graceful posture as key-health alerts). Reused by key-health alerts
// and signup email verification.
export async function sendEmail(opts: {
  to: string;
  from?: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<boolean> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) {
    console.warn("[send-email] suppressed — RESEND_API_KEY unset", {
      to: opts.to,
      subject: opts.subject,
    });
    return false;
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
      return false;
    }
    return true;
  } catch (err) {
    console.error("[send-email] resend POST threw", err);
    return false;
  }
}
