// jsdom doesn't ship ResizeObserver; AI Elements' Conversation uses
// `use-stick-to-bottom` which requires it. Polyfill once globally for tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// `@base-ui` ScrollArea schedules an Element.getAnimations() poll that
// jsdom doesn't implement. Stub to empty array so leaked timers don't crash.
if (
  typeof Element !== "undefined" &&
  typeof (Element.prototype as unknown as { getAnimations?: () => unknown[] })
    .getAnimations !== "function"
) {
  (Element.prototype as unknown as { getAnimations: () => unknown[] }).getAnimations =
    () => [];
}
