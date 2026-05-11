"use client";

export type HighlightsChannelEvent = {
  paperId: string;
  source: "user" | "ai";
};

const CHANNEL_NAME = "episteme.highlights";

let channel: BroadcastChannel | null = null;
let subscriberCount = 0;

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

export function postHighlightsChange(evt: HighlightsChannelEvent): void {
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
  const ch = ensureChannel();
  if (!ch) return () => {};
  subscriberCount += 1;
  const handler = (e: MessageEvent<HighlightsChannelEvent>) => cb(e.data);
  ch.addEventListener("message", handler);
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    ch.removeEventListener("message", handler);
    subscriberCount = Math.max(0, subscriberCount - 1);
    releaseChannel();
  };
}
