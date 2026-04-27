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

// jsdom lacks PointerEvent; @base-ui's button/switch click handlers reference
// `event instanceof PointerEvent`. Provide a minimal polyfill backed by MouseEvent
// — but only when MouseEvent itself is defined (i.e. in jsdom env, not node).
if (
  typeof globalThis.PointerEvent === "undefined" &&
  typeof globalThis.MouseEvent !== "undefined"
) {
  class PointerEventPolyfill extends globalThis.MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}
