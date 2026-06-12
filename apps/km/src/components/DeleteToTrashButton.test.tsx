// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { DeleteToTrashButton } from "./DeleteToTrashButton";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  usePathname: () => "/",
}));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => toastSuccessMock(m),
    error: (m: string) => toastErrorMock(m),
  },
}));

const invalidateMock = vi.fn();
vi.mock("@/lib/drive-sync", () => ({
  invalidateDriveTree: () => invalidateMock(),
}));

beforeEach(() => {
  pushMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  invalidateMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DeleteToTrashButton", () => {
  it("renders a destructive button labelled 'Delete'", () => {
    render(
      <DeleteToTrashButton libraryId={1} kind="paper" id="p1" title="A paper" />,
    );
    const btn = screen.getByRole("button", { name: /delete/i });
    expect(btn).toBeTruthy();
    // destructive variant uses bg-destructive/10 text-destructive
    expect(btn.className).toMatch(/bg-destructive\/10/);
    expect(btn.className).toMatch(/text-destructive/);
  });

  it("on click → confirm → POSTs /api/folders/trash with { libraryId, target: { kind, id } } and redirects", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DeleteToTrashButton libraryId={42} kind="reference" id="r1" title="Ref" />,
    );
    const btn = screen.getByRole("button", { name: /delete/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/folders/trash");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({
      libraryId: 42,
      target: { kind: "reference", id: "r1" },
    });
    expect(toastSuccessMock).toHaveBeenCalled();
    expect(invalidateMock).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/drive");
  });

  it("if user cancels confirm → no fetch, no redirect", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DeleteToTrashButton libraryId={1} kind="note" id="n1" title="Note" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("on failure → toast.error, no redirect", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const fetchMock = vi.fn(async () => new Response("err", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DeleteToTrashButton libraryId={1} kind="paper" id="p1" title="P" />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    });
    expect(toastErrorMock).toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
