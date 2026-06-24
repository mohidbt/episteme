// Builds the signup verification email payload. Pure — no I/O.
export function buildVerificationEmail(opts: {
  url: string;
  firstname?: string | null;
}): { subject: string; text: string; html: string } {
  const name = opts.firstname?.trim();
  const greeting = name ? `Hi ${name},` : "Hi,";
  const subject = "Verify your email for episteme";

  const text = [
    greeting,
    "",
    "Confirm your email address to finish setting up your episteme account:",
    "",
    opts.url,
    "",
    "If you didn't create this account, you can ignore this email.",
  ].join("\n");

  const html = [
    `<p>${greeting}</p>`,
    "<p>Confirm your email address to finish setting up your episteme account.</p>",
    `<p><a href="${opts.url}">Verify my email</a></p>`,
    `<p>Or paste this link into your browser:<br/><a href="${opts.url}">${opts.url}</a></p>`,
    "<p>If you didn't create this account, you can ignore this email.</p>",
  ].join("");

  return { subject, text, html };
}
