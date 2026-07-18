// GSD-220 — programmatically open the Sentry feedback dialog.
//
// The floating actor launcher is hidden (feedback-shadow-css.ts); the
// nav-sidebar "Report a bug" item calls this instead. `getFeedback()` returns
// the feedbackIntegration instance registered in instrumentation-client.ts;
// `createForm()` builds the SAME dialog the actor would have opened (Sentry
// v10 API). The form is cached module-side so repeated clicks reuse one dialog
// instead of leaking a new detached form into the DOM each time.
import { getFeedback } from "@sentry/nextjs";

type FeedbackForm = Awaited<
  ReturnType<NonNullable<ReturnType<typeof getFeedback>>["createForm"]>
>;

let cachedForm: FeedbackForm | null = null;
// In-flight guard: concurrent clicks before createForm() resolves must await the
// SAME promise, else the losing form leaks detached into the DOM (codex GSD-53).
let pendingForm: Promise<FeedbackForm> | null = null;

export async function openFeedbackDialog(): Promise<void> {
  const feedback = getFeedback();
  if (!feedback) return;
  if (!cachedForm) {
    if (!pendingForm) {
      pendingForm = feedback.createForm();
    }
    try {
      cachedForm = await pendingForm;
    } finally {
      pendingForm = null;
    }
  }
  cachedForm.appendToDom();
  cachedForm.open();
}
