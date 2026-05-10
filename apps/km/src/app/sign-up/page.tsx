"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "@episteme/auth/client";
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

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Start hidden to avoid a flash for non-guests; if the session probe
  // fails outright we fail-open (show the warning) rather than letting a
  // guest sign up unwarned because of a network hiccup.
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/get-session", { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`session ${r.status}`);
        return r.json();
      })
      .then((s: { user?: { isAnonymous?: boolean } } | null) => {
        if (!cancelled) setIsGuest(s?.user?.isAnonymous === true);
      })
      .catch(() => {
        if (!cancelled) setIsGuest(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    const { error } = await signUp.email({ email, password, name });
    if (error) {
      setError(error.message ?? "Sign up failed");
      setLoading(false);
      return;
    }
    router.push("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display text-3xl font-normal">Create account</CardTitle>
          <CardDescription>Enter your details to get started</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {isGuest && (
              <p
                role="note"
                data-testid="guest-data-warning"
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
              >
                Heads up: edits made in guest mode (uploaded papers, notes,
                annotations) won&rsquo;t carry over into your new account. You
                start with a clean library.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                minLength={8}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3 pt-6">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating account…" : "Create account"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/sign-in" className="text-foreground underline underline-offset-4">
                Sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
