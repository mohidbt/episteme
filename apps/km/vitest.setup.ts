// ─────────────────────────────────────────────────────────────────────────────
// External service dependencies for the km test suite
// ─────────────────────────────────────────────────────────────────────────────
// Many tests in this suite (anything using `createTestUser` / `deleteTestUser`
// from `src/app/api/_test-utils.ts`, or hitting drizzle directly) require live
// services. There is no global mock — `beforeAll` hooks talk to real Postgres
// via better-auth + drizzle.
//
// Required services BEFORE running `pnpm --filter km test`:
//   • Postgres on :5433  (DATABASE_URL=postgresql://episteme:episteme@localhost:5433/episteme)
//   • MinIO    on :9000  (S3_ENDPOINT=http://localhost:9000, bucket episteme-dev)
//
// Bring them up via the repo `docker-compose.yml` at repo root.
// Symptom when missing: ~65 files fail with `ECONNREFUSED 127.0.0.1:5433`
// (visible in output) or — for tests using long timeouts — `Hook timed out
// in 10000ms` in `beforeAll`. The ECONNREFUSED is the real signal; treat
// timeout-only failures as the same root cause.
// Default env (DATABASE_URL, S3_ENDPOINT, etc.) is wired in `vitest.config.ts`.
// ─────────────────────────────────────────────────────────────────────────────

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
