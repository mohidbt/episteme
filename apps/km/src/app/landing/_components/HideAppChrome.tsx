"use client";

import { useEffect } from "react";

// The marketing landing is a public surface, but the Sentry feedback widget
// ("Report a Bug") is auto-injected globally by instrumentation-client. Flag
// the document while the landing route is mounted so landing.css can hide it
// here without touching the widget anywhere in the app.
export function HideAppChrome() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-landing", "");
    return () => root.removeAttribute("data-landing");
  }, []);
  return null;
}
