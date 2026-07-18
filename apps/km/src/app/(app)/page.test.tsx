// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// GSD-142 defense-in-depth: this representative `(app)` server page must run
// the email-verify gate (via getRequiredUserId) as its FIRST await, so an
// unverified real user never triggers a protected library read. Next.js renders
// the layout's redirect in parallel with this page, so the gate — not the
// layout — is what actually stops the data fetch.

const getRequiredUserIdMock = vi.fn();
const getCurrentSessionMock = vi.fn();
const getDefaultLibraryMock = vi.fn();
const listFolderContentsMock = vi.fn();
const listAllFoldersMock = vi.fn();

class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

vi.mock("@/lib/session", () => ({
  getRequiredUserId: () => getRequiredUserIdMock(),
  getCurrentSession: () => getCurrentSessionMock(),
}));

vi.mock("@/lib/default-library", () => ({
  getDefaultLibrary: (...a: unknown[]) => getDefaultLibraryMock(...a),
}));

vi.mock("@/lib/folders-server", () => ({
  listFolderContents: (...a: unknown[]) => listFolderContentsMock(...a),
  listAllFolders: (...a: unknown[]) => listAllFoldersMock(...a),
}));

vi.mock("@/components/FileBrowser", () => ({
  FileBrowser: () => null,
}));

vi.mock("@/app/(app)/drive/serialize", () => ({
  serializeFolderContents: (x: unknown) => x,
}));

import DriveRootPage from "./page";

beforeEach(() => {
  getRequiredUserIdMock.mockReset();
  getCurrentSessionMock.mockReset();
  getDefaultLibraryMock.mockReset();
  listFolderContentsMock.mockReset();
  listAllFoldersMock.mockReset();
});

describe("DriveRootPage email-verify gating", () => {
  it("does NOT read the library when the verify gate redirects (unverified user)", async () => {
    // getRequiredUserId throws (redirect) for an unverified real user.
    getRequiredUserIdMock.mockRejectedValue(new RedirectError("/verify-email"));

    await expect(DriveRootPage()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(getDefaultLibraryMock).not.toHaveBeenCalled();
    expect(listFolderContentsMock).not.toHaveBeenCalled();
    expect(listAllFoldersMock).not.toHaveBeenCalled();
  });

  it("reads the library for a verified user (gate passes through)", async () => {
    getRequiredUserIdMock.mockResolvedValue("user_verified");
    getCurrentSessionMock.mockResolvedValue({
      userId: "user_verified",
      isAnonymous: false,
      emailVerified: true,
    });
    getDefaultLibraryMock.mockResolvedValue({ id: 1, name: "Lib" });
    listFolderContentsMock.mockResolvedValue([]);
    listAllFoldersMock.mockResolvedValue([]);

    await DriveRootPage();

    expect(getDefaultLibraryMock).toHaveBeenCalledWith("user_verified");
  });
});
