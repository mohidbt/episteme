"use client";

export type HighlightsChannelEvent = {
  paperId: string;
  source: "user" | "ai";
};

const CHANNEL_NAME = "episteme.highlights";

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export function postHighlightsChange(evt: HighlightsChannelEvent): void {
  getChannel()?.postMessage(evt);
}

export function subscribeHighlightsChange(
  cb: (evt: HighlightsChannelEvent) => void,
): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (e: MessageEvent<HighlightsChannelEvent>) => cb(e.data);
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}
