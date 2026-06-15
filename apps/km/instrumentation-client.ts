import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN =
  "https://1a4aee926c61d29a0d00cb44ef98def0@o4511507739049984.ingest.de.sentry.io/4511507747373136";

Sentry.init({
  dsn: SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  // Browser profiling: 10% of sessions in prod. Needs `Document-Policy:
  // js-profiling` header (set in next.config.ts). See GSD-110.
  profileSessionSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  tracePropagationTargets: [
    "localhost",
    /^https:\/\/tryepisteme\.com/,
    /^https:\/\/.*\.vercel\.app/,
  ],
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.browserProfilingIntegration(),
    Sentry.feedbackIntegration({
      colorScheme: "system",
      autoInject: true,
      showBranding: false,
    }),
    Sentry.replayIntegration(),
  ],
  debug: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
