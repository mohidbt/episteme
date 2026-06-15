import * as Sentry from "@sentry/nextjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const SENTRY_DSN =
  "https://1a4aee926c61d29a0d00cb44ef98def0@o4511507739049984.ingest.de.sentry.io/4511507747373136";

Sentry.init({
  dsn: SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  // Profiling: 10% of traced transactions get profiled. See GSD-110 plan
  // for rationale (quota cost vs signal). `profileLifecycle: "trace"` ties
  // profile lifetime to active transactions, avoiding constant CPU sampling.
  profileSessionSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  profileLifecycle: "trace",
  integrations: [nodeProfilingIntegration()],
  debug: false,
});
