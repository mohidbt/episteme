// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../openrouter-provisioning", () => ({
  createUserBucketWithConfig: vi.fn(),
  deleteUserBucket: vi.fn(),
}));

vi.mock("../user-bucket-store", () => ({
  loadUserBucket: vi.fn(),
  updateUserBucket: vi.fn(),
}));

vi.mock("../subscription-store", () => ({
  loadSubscription: vi.fn(),
  upsertSubscription: vi.fn(),
}));

import {
  createUserBucketWithConfig,
  deleteUserBucket,
} from "../openrouter-provisioning";
import { loadUserBucket, updateUserBucket } from "../user-bucket-store";
import { loadSubscription, upsertSubscription } from "../subscription-store";
import {
  activateSubscription,
  cancelSubscription,
  replaceUserBucket,
  resumeSubscription,
} from "../subscription-bucket";

beforeEach(() => {
  vi.mocked(createUserBucketWithConfig).mockReset();
  vi.mocked(deleteUserBucket).mockReset();
  vi.mocked(loadUserBucket).mockReset();
  vi.mocked(updateUserBucket).mockReset();
  vi.mocked(loadSubscription).mockReset();
  vi.mocked(upsertSubscription).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("replaceUserBucket — safe ordering (GSD-140)", () => {
  it("POSTs new key, persists row, THEN deletes old key (in that order)", async () => {
    const order: string[] = [];
    vi.mocked(loadUserBucket).mockResolvedValue({
      runtimeKey: "old-key",
      hash: "h_old",
    });
    vi.mocked(createUserBucketWithConfig).mockImplementation(async () => {
      order.push("post");
      return { key: "new-key", hash: "h_new" };
    });
    vi.mocked(updateUserBucket).mockImplementation(async () => {
      order.push("persist");
    });
    vi.mocked(deleteUserBucket).mockImplementation(async () => {
      order.push("delete");
    });

    await replaceUserBucket("user_1", "high");

    expect(order).toEqual(["post", "persist", "delete"]);
  });

  it("maps High → limit 2 weekly, Max → limit 4 weekly", async () => {
    vi.mocked(loadUserBucket).mockResolvedValue({
      runtimeKey: "old",
      hash: "h_old",
    });
    vi.mocked(createUserBucketWithConfig).mockResolvedValue({
      key: "k",
      hash: "h_new",
    });

    await replaceUserBucket("user_1", "high");
    expect(createUserBucketWithConfig).toHaveBeenCalledWith("user_1", {
      limit: 2,
      label: "high",
      limitReset: "weekly",
    });
    expect(updateUserBucket).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        hash: "h_new",
        runtimeKey: "k",
        tier: "high",
        limitUsd: 2,
        limitReset: "weekly",
      }),
    );

    vi.mocked(createUserBucketWithConfig).mockResolvedValue({
      key: "k2",
      hash: "h_new2",
    });
    await replaceUserBucket("user_1", "max");
    expect(createUserBucketWithConfig).toHaveBeenLastCalledWith("user_1", {
      limit: 4,
      label: "max",
      limitReset: "weekly",
    });
  });

  it("POST failure → no persist, no delete (old key stays intact)", async () => {
    vi.mocked(loadUserBucket).mockResolvedValue({
      runtimeKey: "old",
      hash: "h_old",
    });
    vi.mocked(createUserBucketWithConfig).mockRejectedValue(
      new Error("OR down"),
    );

    await expect(replaceUserBucket("user_1", "high")).rejects.toThrow("OR down");
    expect(updateUserBucket).not.toHaveBeenCalled();
    expect(deleteUserBucket).not.toHaveBeenCalled();
  });

  it("DELETE failure is non-fatal — new key already persisted", async () => {
    vi.mocked(loadUserBucket).mockResolvedValue({
      runtimeKey: "old",
      hash: "h_old",
    });
    vi.mocked(createUserBucketWithConfig).mockResolvedValue({
      key: "new",
      hash: "h_new",
    });
    vi.mocked(deleteUserBucket).mockRejectedValue(new Error("delete 500"));

    // Must NOT throw — user already has the working new key in the DB.
    await expect(replaceUserBucket("user_1", "high")).resolves.toBeUndefined();
    expect(updateUserBucket).toHaveBeenCalledOnce();
  });

  it("no existing bucket row → still mints + persists, skips delete", async () => {
    vi.mocked(loadUserBucket).mockResolvedValue(null);
    vi.mocked(createUserBucketWithConfig).mockResolvedValue({
      key: "new",
      hash: "h_new",
    });

    await replaceUserBucket("user_1", "max");
    expect(updateUserBucket).toHaveBeenCalledOnce();
    expect(deleteUserBucket).not.toHaveBeenCalled();
  });
});

describe("subscription state machine (GSD-140)", () => {
  it("activate → upsert active row + replace bucket to tier", async () => {
    vi.mocked(loadUserBucket).mockResolvedValue({
      runtimeKey: "old",
      hash: "h_old",
    });
    vi.mocked(createUserBucketWithConfig).mockResolvedValue({
      key: "new",
      hash: "h_new",
    });

    await activateSubscription("user_1", "high");

    expect(upsertSubscription).toHaveBeenCalledWith({
      userId: "user_1",
      tier: "high",
      status: "active",
    });
    expect(createUserBucketWithConfig).toHaveBeenCalledWith("user_1", {
      limit: 2,
      label: "high",
      limitReset: "weekly",
    });
  });

  it("cancel → mark canceled + revert bucket to trial ($5, no reset)", async () => {
    vi.mocked(loadSubscription).mockResolvedValue({
      tier: "max",
      status: "active",
    });
    vi.mocked(loadUserBucket).mockResolvedValue({
      runtimeKey: "old",
      hash: "h_old",
    });
    vi.mocked(createUserBucketWithConfig).mockResolvedValue({
      key: "trial",
      hash: "h_trial",
    });

    await cancelSubscription("user_1");

    expect(upsertSubscription).toHaveBeenCalledWith({
      userId: "user_1",
      tier: "max",
      status: "canceled",
    });
    expect(createUserBucketWithConfig).toHaveBeenCalledWith("user_1", {
      limit: 5,
      label: "trial",
      limitReset: null,
    });
    expect(updateUserBucket).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "trial", limitUsd: 5, limitReset: null }),
    );
  });

  it("cancel with no subscription row → no-op", async () => {
    vi.mocked(loadSubscription).mockResolvedValue(null);
    await cancelSubscription("user_1");
    expect(upsertSubscription).not.toHaveBeenCalled();
    expect(createUserBucketWithConfig).not.toHaveBeenCalled();
  });

  it("resume → mark active + replace bucket to the sub's tier", async () => {
    vi.mocked(loadSubscription).mockResolvedValue({
      tier: "high",
      status: "canceled",
    });
    vi.mocked(loadUserBucket).mockResolvedValue({
      runtimeKey: "old",
      hash: "h_old",
    });
    vi.mocked(createUserBucketWithConfig).mockResolvedValue({
      key: "new",
      hash: "h_new",
    });

    await resumeSubscription("user_1");

    expect(upsertSubscription).toHaveBeenCalledWith({
      userId: "user_1",
      tier: "high",
      status: "active",
    });
    expect(createUserBucketWithConfig).toHaveBeenCalledWith("user_1", {
      limit: 2,
      label: "high",
      limitReset: "weekly",
    });
  });

  it("resume with no subscription row → no-op", async () => {
    vi.mocked(loadSubscription).mockResolvedValue(null);
    await resumeSubscription("user_1");
    expect(upsertSubscription).not.toHaveBeenCalled();
  });
});
