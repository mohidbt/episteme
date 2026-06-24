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

export function VerifyEmailClient({ error }: { error: string | null }) {
  const router = useRouter();
  if (!error) return <SuccessCard onContinue={() => router.push("/")} />;
  return <ResendCard />;
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

function ResendCard() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

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
            Link expired or invalid
          </CardTitle>
          <CardDescription>
            That verification link is no longer valid. Enter your email and
            we&apos;ll send a fresh one.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleResend}>
          <CardContent className="space-y-4">
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
            <Button type="submit" disabled={status === "sending" || !email.trim()}>
              {status === "sending" ? "Sending…" : "Resend verification email"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
