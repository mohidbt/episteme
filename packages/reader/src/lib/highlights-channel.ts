"use client";

export type HighlightsChannelEvent = {
  paperId: string;
  source: "user" | "ai";
};

const CHANNEL_NAME = "episteme.highlights";

let channel: BroadcastChannel | null = null;
let subscriberCount = 0;
const localSubscribers = new Set<(evt: HighlightsChannelEvent) => void>();

function isSupported(): boolean {
  return typeof window !== "undefined" && typeof BroadcastChannel !== "undefined";
}

function ensureChannel(): BroadcastChannel | null {
  if (!isSupported()) return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

function releaseChannel(): void {
  if (channel && subscriberCount === 0) {
    channel.close();
    channel = null;
  }
}

function shouldLogDebug(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

function notifyLocal(evt: HighlightsChannelEvent): void {
  // Snapshot before invoking — subscribers may unsubscribe during dispatch
  // and we don't want to mutate the Set we're iterating.
  for (const cb of Array.from(localSubscribers)) {
    try {
      cb(evt);
    } catch (err) {
      if (shouldLogDebug()) {
        console.debug("highlights_channel_local_callback_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

export function postHighlightsChange(evt: HighlightsChannelEvent): void {
  // ALWAYS fan out to in-process subscribers first. The BroadcastChannel
  // spec explicitly does NOT deliver messages to the BroadcastChannel
  // instance that sent them, even within the same tab — so without this
  // local dispatch, a sibling component posting a change would never
  // notify a `usePaperHighlights` hook mounted in the same tab. The
  // BroadcastChannel below remains for cross-tab fan-out only.
  notifyLocal(evt);

  if (!isSupported()) {
    if (shouldLogDebug()) {
      console.debug("highlights_channel_post_skipped", { reason: "unsupported" });
    }
    return;
  }
  // Lazy create + close-if-orphan: posting from a tab with zero local
  // subscribers (e.g. a non-reader page emitting a write) must not leak a
  // channel handle.
  const owns = channel === null;
  const ch = ensureChannel();
  try {
    ch?.postMessage(evt);
  } catch (err) {
    if (shouldLogDebug()) {
      console.debug("highlights_channel_post_failed", {
        paperId: evt.paperId,
        source: evt.source,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    if (owns && subscriberCount === 0) {
      channel?.close();
      channel = null;
    }
  }
}

export function subscribeHighlightsChange(
  cb: (evt: HighlightsChannelEvent) => void,
): () => void {
  // Register the local subscriber unconditionally so same-tab writes
  // reach this listener even when BroadcastChannel is unavailable
  // (SSR, older browsers, test environments without happy-dom shims).
  localSubscribers.add(cb);
  const ch = ensureChannel();
  let bcHandler: ((e: MessageEvent<HighlightsChannelEvent>) => void) | null = null;
  if (ch) {
    subscriberCount += 1;
    bcHandler = (e: MessageEvent<HighlightsChannelEvent>) => cb(e.data);
    ch.addEventListener("message", bcHandler);
  }
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    localSubscribers.delete(cb);
    if (ch && bcHandler) {
      ch.removeEventListener("message", bcHandler);
      subscriberCount = Math.max(0, subscriberCount - 1);
      releaseChannel();
    }
  };
}
