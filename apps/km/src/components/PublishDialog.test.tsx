// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { PublishDialog } from "./PublishDialog";

type FetchImpl = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(impl: FetchImpl) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return impl(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /publish/i }));
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// B11: publish flow is paused. The dialog still renders so users see the
// shape of what's coming, but actions are disabled and a banner explains
// the status. These tests pin the under-construction contract.
describe("PublishDialog (under construction)", () => {
  it("opens dialog and shows the under-construction banner", async () => {
    mockFetch(() => new Response("nope", { status: 404 }));
    render(
      <PublishDialog
        noteId="n-1"
        initialUsername="alice"
        initialIsPublic={false}
        initialPublicSlug={null}
        defaultSlug="hello"
      />,
    );
    openDialog();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    const banner = screen.getByTestId("publish-under-construction");
    expect(banner.textContent ?? "").toMatch(/under construction/i);
  });

  it("shows username-claim form when initialUsername is null, but Claim is disabled", async () => {
    mockFetch(() => new Response("nope", { status: 404 }));
    render(
      <PublishDialog
        noteId="n-1"
        initialUsername={null}
        initialIsPublic={false}
        initialPublicSlug={null}
        defaultSlug="hello"
      />,
    );
    openDialog();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByTestId("username-input")).toBeTruthy();
    const claim = screen.getByTestId("claim-username") as HTMLButtonElement;
    expect(claim.disabled).toBe(true);
  });

  it("renders URL preview from username + publicSlug", async () => {
    mockFetch(() => new Response("nope", { status: 404 }));
    render(
      <PublishDialog
        noteId="n-1"
        initialUsername="alice"
        initialIsPublic={false}
        initialPublicSlug="hello"
        defaultSlug="hello"
      />,
    );
    openDialog();
    await waitFor(() => {
      expect(screen.getByTestId("url-preview").textContent).toContain(
        "alice.tryepisteme.com/hello",
      );
    });
  });

  it("disables the public toggle so users cannot trigger a publish request", async () => {
    const fetchFn = mockFetch(() => new Response("nope", { status: 404 }));
    render(
      <PublishDialog
        noteId="n-1"
        initialUsername="alice"
        initialIsPublic={false}
        initialPublicSlug="hello"
        defaultSlug="hello"
      />,
    );
    openDialog();
    const toggle = (await waitFor(() =>
      screen.getByTestId("public-toggle"),
    )) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    // Disabled checkbox should not fire onChange when clicked.
    fireEvent.click(toggle);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("still surfaces Copy URL when a note was already public before the freeze", async () => {
    mockFetch(() => new Response("nope", { status: 404 }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <PublishDialog
        noteId="n-1"
        initialUsername="alice"
        initialIsPublic={true}
        initialPublicSlug="hello"
        defaultSlug="hello"
      />,
    );
    openDialog();
    const copyBtn = await waitFor(() => screen.getByTestId("copy-url"));
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://alice.tryepisteme.com/hello");
    });
  });
});
