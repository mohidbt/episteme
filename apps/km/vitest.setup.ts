// jsdom in some configurations exposes a non-functional `window.localStorage`.
// Replace with a minimal in-memory polyfill so hooks/components that persist
// state can run in tests.
if (typeof globalThis.window !== "undefined") {
  const w = globalThis.window as unknown as { localStorage?: Storage };
  const needs =
    !w.localStorage ||
    typeof (w.localStorage as Storage).getItem !== "function";
  if (needs) {
    const store = new Map<string, string>();
    const ls: Storage = {
      get length() {
        return store.size;
      },
      clear() {
        store.clear();
      },
      getItem(k: string) {
        return store.has(k) ? (store.get(k) as string) : null;
      },
      key(i: number) {
        return Array.from(store.keys())[i] ?? null;
      },
      removeItem(k: string) {
        store.delete(k);
      },
      setItem(k: string, v: string) {
        store.set(k, String(v));
      },
    };
    Object.defineProperty(w, "localStorage", { value: ls, configurable: true });
  }
}

// jsdom doesn't ship ResizeObserver; AI Elements' Conversation uses
// `use-stick-to-bottom` which requires it. Polyfill once globally for tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom doesn't implement Element.scrollIntoView; cmdk (used by Command/Combobox)
// calls it on mount/select. Stub as no-op.
if (
  typeof Element !== "undefined" &&
  typeof (Element.prototype as unknown as { scrollIntoView?: () => void })
    .scrollIntoView !== "function"
) {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
    () => {};
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
