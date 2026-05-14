"use client";

import { useState } from "react";
import { GlobeIcon, Construction } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidUsername } from "@/lib/username";

// B11: publishing pipeline is paused for soak. Dialog renders read-only with a
// prominent banner; submit actions are disabled so users see the panel they
// know but can't trigger a publish round-trip.
const PUBLISHING_DISABLED = true;

// The public URL is cosmetic in the client; the functional host mapping is
// done server-side via EPISTEME_PUBLISH_DOMAIN + the proxy. In dev the URL may
// not resolve — the copy button still produces a canonical production URL.
const PUBLISH_DOMAIN = "tryepisteme.com";

export function PublishDialog({
  noteId,
  initialUsername,
  initialIsPublic,
  initialPublicSlug,
  defaultSlug,
}: {
  noteId: string;
  initialUsername: string | null;
  initialIsPublic: boolean;
  initialPublicSlug: string | null;
  defaultSlug: string;
}) {
  const [username, setUsername] = useState<string | null>(initialUsername);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [publicSlug, setPublicSlug] = useState(
    initialPublicSlug ?? defaultSlug,
  );
  const [usernameDraft, setUsernameDraft] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const url = username ? `${username}.${PUBLISH_DOMAIN}/${publicSlug}` : "";

  async function claimUsername() {
    if (PUBLISHING_DISABLED || busy) return;
    setClaimError(null);
    const name = usernameDraft.trim().toLowerCase();
    if (!isValidUsername(name)) {
      setClaimError("Invalid username");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/users/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: name }),
      });
      if (res.status === 409) {
        setClaimError("Username taken");
        return;
      }
      if (!res.ok) {
        setClaimError("Could not claim username");
        return;
      }
      const data = (await res.json()) as { username: string };
      setUsername(data.username);
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish(next: boolean) {
    if (PUBLISHING_DISABLED || busy) return;
    setPublishError(null);
    setBusy(true);
    try {
      const body = next
        ? { isPublic: true, publicSlug }
        : { isPublic: false };
      const res = await fetch(`/api/notes/${noteId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        setPublishError("That slug is taken");
        return;
      }
      if (!res.ok) {
        setPublishError("Could not update publish status");
        return;
      }
      const data = (await res.json()) as {
        isPublic: boolean;
        publicSlug: string | null;
      };
      setIsPublic(data.isPublic);
      if (data.publicSlug) setPublicSlug(data.publicSlug);
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    await navigator.clipboard?.writeText(`https://${url}`);
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Publish">
            <GlobeIcon />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish</DialogTitle>
        </DialogHeader>
        <Alert data-testid="publish-under-construction">
          <Construction />
          <AlertTitle>Publishing is under construction</AlertTitle>
          <AlertDescription>
            Coming soon — we&apos;re polishing the publish flow. You can still
            see the panel, but submitting is disabled for now.
          </AlertDescription>
        </Alert>
        <div className="flex flex-col gap-3 p-1">
          {!username ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Choose a username to enable publishing.
              </p>
              <div className="flex gap-2">
                <Input
                  value={usernameDraft}
                  onChange={(e) => setUsernameDraft(e.target.value)}
                  placeholder="yourname"
                  data-testid="username-input"
                />
                <Button
                  onClick={claimUsername}
                  disabled={busy || PUBLISHING_DISABLED}
                  data-testid="claim-username"
                >
                  Claim
                </Button>
              </div>
              {claimError && (
                <div
                  data-testid="claim-error"
                  className="text-xs text-destructive"
                >
                  {claimError}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => togglePublish(e.target.checked)}
                  disabled={busy || PUBLISHING_DISABLED}
                  data-testid="public-toggle"
                />
                Public
              </label>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  URL
                </label>
                <Input
                  value={publicSlug}
                  onChange={(e) => setPublicSlug(e.target.value)}
                  data-testid="slug-input"
                  placeholder={defaultSlug}
                />
                <div
                  data-testid="url-preview"
                  className="mt-2 text-xs text-muted-foreground"
                >
                  {url}
                </div>
              </div>
              {publishError && (
                <div
                  data-testid="publish-error"
                  className="text-xs text-destructive"
                >
                  {publishError}
                </div>
              )}
              {isPublic && (
                <Button
                  variant="outline"
                  onClick={copyUrl}
                  data-testid="copy-url"
                >
                  Copy URL
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
