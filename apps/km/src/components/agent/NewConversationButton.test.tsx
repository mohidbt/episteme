// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NewConversationButton } from "./NewConversationButton";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          thread: {
            userId: "u",
            threadId: "new-thread-id",
            modelOverride: null,
            title: null,
            skill: null,
            status: "idle",
            lastMessageAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NewConversationButton", () => {
  it("posts and navigates to new thread", async () => {
    render(<NewConversationButton />);
    fireEvent.click(screen.getByTestId("new-conversation-button"));
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/agents/new-thread-id");
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent/threads",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
