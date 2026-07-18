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
      // Keep an accessible name + clear dialog copy. The floating actor is
      // hidden via shadow-DOM styling below and replaced by a nav-sidebar
      // "Report a bug" item that opens the same dialog (GSD-220). Colors/
      // radius/font come from #sentry-feedback design-token vars in
      // globals.css. GSD-143.
      triggerAriaLabel: "Report a bug",
      formTitle: "Report a bug",
      submitButtonLabel: "Send report",
    }),
    Sentry.replayIntegration(),
  ],
  debug: false,
});

// The Sentry feedback actor + dialog render inside a shadow root that global
// CSS can't reach. Inject a stylesheet into it to (1) hide the floating actor
// button — it is replaced by a nav-sidebar "Report a bug" item that opens the
// same dialog via getFeedback().attachTo (GSD-220), and (2) fix the dialog
// field focus ring: Sentry's `.form__input:focus-visible { outline }` draws the
// ring OUTSIDE the full-width input's border box, so the overflow:auto dialog
// clips it on the left/right edges. `outline-offset: -2px` pulls the ring
// inside the border box so it is fully visible on all four sides (GSD-220).
// Token-based colors still come from the #sentry-feedback vars in globals.css.
export const FEEDBACK_SHADOW_CSS = `
  .widget__actor { display: none !important; }
  .form__input:focus,
  .form__input:focus-visible {
    outline-offset: -2px;
  }
`;

function styleFeedbackShadow() {
  const inject = (host: Element) => {
    const sr = (host as HTMLElement).shadowRoot;
    if (!sr || sr.querySelector("style[data-gsd220]")) return;
    const style = document.createElement("style");
    style.setAttribute("data-gsd220", "");
    style.textContent = FEEDBACK_SHADOW_CSS;
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
styleFeedbackShadow();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
