"use client";

// D4 signup form — fields beyond the better-auth defaults (firstname,
// username, user_type, pokemon, invite_code) are required and validated
// server-side by /api/auth/signup-real. The pokemon picker uses 8-bit
// pixel-art tiles served from /pokemon/{slug}.png as a static placeholder;
// see task report for rationale.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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

export const POKEMON_OPTIONS = [
  { value: "charmander", label: "Charmander", color: "#f08030" },
  { value: "squirtle", label: "Squirtle", color: "#6890f0" },
  { value: "bulbasaur", label: "Bulbasaur", color: "#78c850" },
] as const;

export const USER_TYPE_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "researcher", label: "Researcher" },
  { value: "industry", label: "Industry" },
  { value: "other", label: "Other" },
] as const;

type Pokemon = (typeof POKEMON_OPTIONS)[number]["value"];
type UserType = (typeof USER_TYPE_OPTIONS)[number]["value"];

const USERNAME_RE = /^[a-z0-9_-]+$/;

export interface SignupFormProps {
  /** Override the fetch endpoint for tests. */
  endpoint?: string;
  /** Skip router.push after success, for tests that probe submit payload. */
  onSuccess?: () => void;
}

export function SignupForm({
  endpoint = "/api/auth/signup-real",
  onSuccess,
}: SignupFormProps) {
  const router = useRouter();
  const [firstname, setFirstname] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userType, setUserType] = useState<UserType | "">("");
  const [pokemon, setPokemon] = useState<Pokemon | "">("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

  function validate(): string | null {
    if (!firstname.trim()) return "First name is required";
    if (!username.trim()) return "Username is required";
    if (username.length < 3) return "Username must be at least 3 characters";
    if (!USERNAME_RE.test(username))
      return "Username must use only lowercase a-z, 0-9, _ or -";
    if (!email.trim()) return "Email is required";
    if (password.length < 8) return "Password must be at least 8 characters";
    if (!userType) return "Please pick what describes you best";
    if (!pokemon) return "Please pick a starter pokemon";
    if (!inviteCode.trim()) return "Invite code is required";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstname: firstname.trim(),
          username: username.trim(),
          email: email.trim(),
          password,
          userType,
          pokemon,
          inviteCode: inviteCode.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        const msg =
          body.error === "invite_invalid"
            ? "That invite code isn't valid or has already been used"
            : body.error === "email_taken"
              ? "An account with that email already exists"
              : body.error === "username_taken"
                ? "That username is taken"
                : body.error === "validation"
                  ? "Please check the form fields"
                  : "Sign up failed";
        setError(msg);
        setLoading(false);
        return;
      }
      if (onSuccess) onSuccess();
      else router.push("/");
    } catch {
      setError("Sign up failed");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display text-3xl font-normal">
            Create account
          </CardTitle>
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
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="firstname">First name</Label>
              <Input
                id="firstname"
                type="text"
                value={firstname}
                onChange={(e) => setFirstname(e.target.value)}
                placeholder="Alex"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="lowercase, numbers, _ or -"
                minLength={3}
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

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                What describes you best?
              </legend>
              <div
                className="grid grid-cols-2 gap-2"
                role="radiogroup"
                aria-label="user type"
              >
                {USER_TYPE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm ${
                      userType === opt.value
                        ? "border-foreground bg-foreground/5"
                        : "border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="userType"
                      value={opt.value}
                      checked={userType === opt.value}
                      onChange={() => setUserType(opt.value)}
                      className="sr-only"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Pick your starter
              </legend>
              <div
                className="grid grid-cols-3 gap-2"
                role="radiogroup"
                aria-label="pokemon"
              >
                {POKEMON_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={pokemon === opt.value}
                    aria-label={opt.label}
                    data-testid={`pokemon-${opt.value}`}
                    onClick={() => setPokemon(opt.value)}
                    className={`flex flex-col items-center gap-1 rounded-md border p-2 transition ${
                      pokemon === opt.value
                        ? "border-foreground ring-2 ring-foreground"
                        : "border-border"
                    }`}
                  >
                    <PokemonPixelTile slug={opt.value} accent={opt.color} />
                    <span className="text-xs">{opt.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="inviteCode">Invite code</Label>
              <Input
                id="inviteCode"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="EPISTEME-XXXX"
                required
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3 pt-6">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating account…" : "Create account"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href="/sign-in"
                className="text-foreground underline underline-offset-4"
              >
                Sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

// Tiny 8x8 pixel-art tile. Uses a per-pokemon two-tone palette
// (transparent + accent) so we don't ship binary assets. The pattern is a
// stylized creature silhouette; intentionally chunky to read as "8-bit".
function PokemonPixelTile({
  slug,
  accent,
}: {
  slug: "charmander" | "squirtle" | "bulbasaur";
  accent: string;
}) {
  const pattern = PIXEL_PATTERNS[slug];
  return (
    <div
      aria-hidden="true"
      className="grid h-12 w-12"
      style={{
        gridTemplateColumns: "repeat(8, 1fr)",
        gridTemplateRows: "repeat(8, 1fr)",
      }}
    >
      {pattern.split("").map((c, i) => (
        <div
          key={i}
          style={{
            backgroundColor: c === "1" ? accent : "transparent",
          }}
        />
      ))}
    </div>
  );
}

// 8x8 hand-painted pixel patterns. Row-major, 64 chars each.
// '1' = filled with accent color, '0' = transparent.
const PIXEL_PATTERNS: Record<"charmander" | "squirtle" | "bulbasaur", string> =
  {
    // Flame tail silhouette
    charmander:
      "00011000" +
      "00111100" +
      "01111110" +
      "01111110" +
      "11111111" +
      "11111111" +
      "01111110" +
      "00100100",
    // Shell + head
    squirtle:
      "00111100" +
      "01111110" +
      "11111111" +
      "11000011" +
      "11011011" +
      "11000011" +
      "01111110" +
      "00100100",
    // Bulb leaf on top
    bulbasaur:
      "00100100" +
      "01111110" +
      "11111111" +
      "01111110" +
      "01111110" +
      "11111111" +
      "01111110" +
      "00100100",
  };
