import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    // Loudly flag a missing Resend key at boot — a silent no-op here traps new
    // users behind the email-verification gate (GSD-142).
    const { assertResendConfigured } = await import(
      "./src/lib/assert-email-config"
    );
    assertResendConfigured();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
