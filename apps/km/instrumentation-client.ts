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
      // Keep an accessible name + clear dialog copy. The visible actor is
      // shrunk to a compact icon-only button via shadow-DOM styling below —
      // Sentry has no icon-only option (an empty buttonLabel just falls back to
      // the default "Report a Bug" label). Colors/radius/font come from the
      // #sentry-feedback design-token vars in globals.css. GSD-143.
      triggerAriaLabel: "Report a bug",
      formTitle: "Report a bug",
      submitButtonLabel: "Send report",
    }),
    Sentry.replayIntegration(),
  ],
  debug: false,
});

// The Sentry feedback actor renders inside a shadow root that global CSS can't
// reach. Inject a small stylesheet into it to drop the text label and render a
// compact circular icon button (the default pill was too large / intrusive —
// GSD-143). Token-based colors come from #sentry-feedback vars in globals.css.
function compactFeedbackActor() {
  const inject = (host: Element) => {
    const sr = (host as HTMLElement).shadowRoot;
    if (!sr || sr.querySelector("style[data-gsd143]")) return;
    const style = document.createElement("style");
    style.setAttribute("data-gsd143", "");
    style.textContent = `
      .widget__actor span { display: none; }
      .widget__actor {
        width: 44px; height: 44px; padding: 0;
        justify-content: center; border-radius: 9999px;
      }
    `;
    sr.appendChild(style);
  };
  const existing = document.querySelector("#sentry-feedback");
  if (existing) {
    inject(existing);
    return;
  }
  const obs = new MutationObserver(() => {
    const el = document.querySelector("#sentry-feedback");
    if (el) {
      inject(el);
      obs.disconnect();
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  // Safety: stop watching after the widget has had ample time to inject.
  setTimeout(() => obs.disconnect(), 10000);
}
compactFeedbackActor();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
