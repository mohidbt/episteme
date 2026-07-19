"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@episteme/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const CALLBACK_PATH = "/verify-email";

/**
 * Three states (GSD-142):
 * - `error` present   → the verify link was bad/expired → ResendCard (expired).
 * - `verified`        → arrived after a successful verify click → SuccessCard.
 * - otherwise         → an unverified real user routed here by the hard-block
 *                       gate → ResendCard (pending, "check your inbox").
 *
 * Before GSD-142 the page only had success/error states, so a freshly
 * signed-up (unverified) user redirected here wrongly saw "Email verified".
 */
export function VerifyEmailClient({
  error,
  verified,
  email,
}: {
  error: string | null;
  verified: boolean;
  email: string | null;
}) {
  const router = useRouter();
  if (error) return <ResendCard initialEmail={email} expired />;
  if (verified) return <SuccessCard onContinue={() => router.push("/")} />;
  return <ResendCard initialEmail={email} expired={false} />;
}

function SuccessCard({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display text-3xl font-normal">
            Email verified
          </CardTitle>
          <CardDescription>
            Your email address is confirmed. You&apos;re all set.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={onContinue}>Continue</Button>
        </CardFooter>
      </Card>
    </div>
  );
}

/**
 * Shown both to unverified users the gate redirected here (`expired={false}`,
 * "check your inbox") and after a broken verify link (`expired`, "link
 * expired"). When the user's email is known (from the session) it is prefilled
 * and the input hidden, so they resend without retyping.
 */
function ResendCard({
  initialEmail,
  expired,
}: {
  initialEmail: string | null;
  expired: boolean;
}) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const knownEmail = Boolean(initialEmail);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: email.trim(),
        callbackURL: CALLBACK_PATH,
      });
      setStatus(error ? "error" : "sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display text-3xl font-normal">
            {expired ? "Link expired or invalid" : "Verify your email"}
          </CardTitle>
          <CardDescription>
            {expired
              ? "That verification link is no longer valid. Enter your email and we'll send a fresh one."
              : knownEmail
                ? `We sent a verification link to ${initialEmail}. Click it to unlock your account — then you're in. Didn't get it?`
                : "Verify your email to continue. Enter your email and we'll send a link."}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleResend}>
          <CardContent className="space-y-4">
            {!knownEmail && (
              <div className="space-y-2">
                <Label htmlFor="resend-email">Email</Label>
                <Input
                  id="resend-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
            )}
            {status === "sent" && (
              <p className="text-sm text-muted-foreground">
                Sent. Check your inbox for the new link.
              </p>
            )}
            {status === "error" && (
              <p className="text-sm text-destructive">
                Couldn&apos;t send right now. Try again in a moment.
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              disabled={status === "sending" || !email.trim()}
            >
              {status === "sending" ? "Sending…" : "Resend verification email"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
