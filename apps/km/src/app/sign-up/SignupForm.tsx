"use client";

// D4 signup wizard. Required account fields stay in the main user row; persona
// detail fields are persisted server-side in user_signup_profiles.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
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
import { USERNAME_REGEX } from "@/lib/username";
import {
  fetchUniversities,
  type UniversityOption,
} from "@/lib/universities";

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

const STUDENT_LEVELS = ["Bachelor", "Master", "PhD"] as const;

type Pokemon = (typeof POKEMON_OPTIONS)[number]["value"];
type UserType = (typeof USER_TYPE_OPTIONS)[number]["value"];
type StudentLevel = (typeof STUDENT_LEVELS)[number];
type Step =
  | "identity"
  | "email"
  | "persona"
  | "persona-detail"
  | "university"
  | "starter"
  | "invite"
  | "password";

// GSD-119: university step shown only for students/researchers.
function stepsFor(userType: UserType | ""): Step[] {
  const includeUni = userType === "student" || userType === "researcher";
  return includeUni
    ? [
        "identity",
        "email",
        "persona",
        "persona-detail",
        "university",
        "starter",
        "invite",
        "password",
      ]
    : [
        "identity",
        "email",
        "persona",
        "persona-detail",
        "starter",
        "invite",
        "password",
      ];
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UsernameAvail =
  | "idle"
  | "checking"
  | "available"
  | "invalid"
  | "reserved"
  | "taken";

interface AvailabilityResponse {
  available: boolean;
  reason?: "invalid" | "reserved" | "taken";
}

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
  const [step, setStep] = useState<Step>("identity");
  const [firstname, setFirstname] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userType, setUserType] = useState<UserType | "">("");
  const [studentLevel, setStudentLevel] = useState<StudentLevel | "">("");
  const [jobRole, setJobRole] = useState("");
  const [industry, setIndustry] = useState("");
  const [personaOther, setPersonaOther] = useState("");
  const [pokemon, setPokemon] = useState<Pokemon | "">("");
  const [inviteCode, setInviteCode] = useState("");
  const [university, setUniversity] = useState("");
  const [uniSuggestions, setUniSuggestions] = useState<UniversityOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [usernameAvail, setUsernameAvail] = useState<UsernameAvail>("idle");

  const steps = useMemo(() => stepsFor(userType), [userType]);
  const stepIndex = steps.indexOf(step);
  const progress = useMemo(
    () => Math.round(((stepIndex + 1) / steps.length) * 100),
    [stepIndex, steps.length],
  );

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

  // Debounced availability check. Only fires after username passes
  // local format/length. Stale debounces ignored via cancelled flag.
  useEffect(() => {
    const name = username.trim();
    if (!name) {
      setUsernameAvail("idle");
      return;
    }
    if (!USERNAME_REGEX.test(name)) {
      setUsernameAvail("invalid");
      return;
    }
    setUsernameAvail("checking");
    let cancelled = false;
    const t = setTimeout(() => {
      fetchAvailability(name)
        .then((s) => {
          if (!cancelled) setUsernameAvail(s);
        })
        .catch(() => {
          // Network error: don't block; fall back to idle so handleContinue
          // can re-fetch race-safe.
          if (!cancelled) setUsernameAvail("idle");
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [username]);

  // GSD-119: debounced Hipolabs lookup. AbortController cancels stale
  // queries when the user keeps typing. Failures silently yield no
  // suggestions — caller can still submit free-text.
  useEffect(() => {
    if (step !== "university") return;
    const q = university.trim();
    if (q.length < 2) {
      setUniSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetchUniversities(q, ctrl.signal)
        .then((list) => setUniSuggestions(list.slice(0, 8)))
        .catch(() => setUniSuggestions([]));
    }, 350);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [university, step]);

  function personaDetails() {
    if (userType === "student") return { studentLevel };
    if (userType === "researcher") return { jobRole: jobRole.trim() };
    if (userType === "industry") {
      return { jobRole: jobRole.trim(), industry: industry.trim() };
    }
    if (userType === "other") return { personaOther: personaOther.trim() };
    return {};
  }

  function basePayload() {
    const name = firstname.trim();
    // Keep DB column firstName: use the first whitespace-delimited token
    // (so "John Doe" → "John", "Madonna" → "Madonna").
    const firstToken = name.split(/\s+/)[0] || name;
    const uni = university.trim();
    const uniField =
      (userType === "student" || userType === "researcher") && uni
        ? { university: uni }
        : {};
    return {
      firstname: firstToken,
      username: username.trim(),
      email: email.trim(),
      userType,
      pokemon,
      ...personaDetails(),
      ...uniField,
    };
  }

  function validateStep(current: Step): string | null {
    if (current === "identity") {
      if (!firstname.trim()) return "Name is required";
      if (!username.trim()) return "Username is required";
      if (username.length < 3) return "Username must be at least 3 characters";
      if (!USERNAME_REGEX.test(username))
        return "Username must use only lowercase a-z, 0-9 or -";
    }
    if (current === "email") {
      if (!email.trim()) return "Email is required";
      if (!EMAIL_RE.test(email.trim())) return "Please enter a valid email";
    }
    if (current === "persona" && !userType) {
      return "Please pick what describes you best";
    }
    if (current === "persona-detail") {
      if (userType === "student" && !studentLevel)
        return "Please pick your student level";
      if (userType === "researcher" && !jobRole.trim())
        return "Job role is required";
      if (userType === "industry" && !jobRole.trim())
        return "Job role is required";
      if (userType === "industry" && !industry.trim())
        return "Industry is required";
      if (userType === "other" && !personaOther.trim())
        return "Please tell us what describes you";
    }
    if (current === "starter" && !pokemon) {
      return "Please pick a starter pokemon";
    }
    if (current === "invite" && !inviteCode.trim()) {
      return "Invite code is required";
    }
    if (current === "password" && password.length < 8) {
      return "Password must be at least 8 characters";
    }
    return null;
  }

  async function fetchAvailability(name: string): Promise<UsernameAvail> {
    const res = await fetch(
      `/api/auth/username/available?u=${encodeURIComponent(name)}`,
      { credentials: "include" },
    );
    if (!res.ok) throw new Error(`availability ${res.status}`);
    const body = (await res.json()) as AvailabilityResponse;
    if (body.available) return "available";
    if (body.reason === "reserved") return "reserved";
    if (body.reason === "taken") return "taken";
    return "invalid";
  }

  async function validateInvite(): Promise<boolean> {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/invite/validate", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteCode: inviteCode.trim() }),
      });
      if (!res.ok) {
        setError("That invite code isn't valid or has already been used");
        return false;
      }
      return true;
    } catch {
      setError("Invite validation failed");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleContinue() {
    setError(null);
    const v = validateStep(step);
    if (v) {
      setError(v);
      return;
    }
    if (step === "identity") {
      let avail = usernameAvail;
      if (avail === "idle" || avail === "checking") {
        setLoading(true);
        try {
          avail = await fetchAvailability(username.trim());
          setUsernameAvail(avail);
        } catch {
          setError("Could not verify username, try again");
          setLoading(false);
          return;
        }
        setLoading(false);
      }
      if (avail !== "available") {
        setError(messageForAvail(avail));
        return;
      }
    }
    if (step === "invite") {
      const ok = await validateInvite();
      if (!ok) return;
    }
    setStep(steps[Math.min(stepIndex + 1, steps.length - 1)]);
  }

  function handleBack() {
    setError(null);
    setStep(steps[Math.max(stepIndex - 1, 0)]);
  }

  async function handleWaitlist() {
    setError(null);
    setLoading(true);
    const attemptedInviteCode = inviteCode.trim();
    try {
      const res = await fetch("/api/auth/waitlist", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...basePayload(),
          ...(attemptedInviteCode ? { attemptedInviteCode } : {}),
        }),
      });
      if (!res.ok) {
        setError("Could not join the waitlist");
        return;
      }
      toast.success("You're on the waitlist", {
        description: "We'll email you when your invite is ready.",
      });
    } catch {
      setError("Could not join the waitlist");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step !== "password") {
      await handleContinue();
      return;
    }
    setError(null);
    const v = validateStep("password");
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
          ...basePayload(),
          password,
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
        return;
      }
      if (onSuccess) onSuccess();
      else router.push("/");
    } catch {
      setError("Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="gap-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="font-display text-3xl font-normal">
              Create account
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              Step {stepIndex + 1} of {steps.length}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-foreground transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <CardDescription>{descriptionForStep(step)}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {isGuest && step === "identity" && (
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

            {step === "identity" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="firstname">Name</Label>
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
                    placeholder="lowercase, numbers or -"
                    minLength={3}
                    required
                    aria-invalid={
                      usernameAvail === "taken" ||
                      usernameAvail === "reserved" ||
                      usernameAvail === "invalid"
                    }
                    aria-describedby="username-status"
                  />
                  {username.trim() && usernameAvail !== "idle" && (
                    <p
                      id="username-status"
                      data-testid="username-status"
                      className={
                        usernameAvail === "available"
                          ? "text-xs text-muted-foreground"
                          : usernameAvail === "checking"
                            ? "text-xs text-muted-foreground"
                            : "text-xs text-destructive"
                      }
                    >
                      {usernameAvail === "available"
                        ? "Username is available"
                        : messageForAvail(usernameAvail)}
                    </p>
                  )}
                </div>
              </>
            )}

            {step === "email" && (
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
            )}

            {step === "persona" && (
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
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={userType === opt.value}
                      aria-label={opt.label}
                      onClick={() => {
                        setUserType(opt.value);
                        setStudentLevel("");
                        setJobRole("");
                        setIndustry("");
                        setPersonaOther("");
                        setUniversity("");
                        setUniSuggestions([]);
                      }}
                      className={`flex items-center justify-center rounded-md border px-3 py-2 text-sm ${
                        userType === opt.value
                          ? "border-foreground bg-foreground/5"
                          : "border-border"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {step === "persona-detail" && userType === "student" && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Student level</legend>
                <div
                  className="grid grid-cols-3 gap-2"
                  role="radiogroup"
                  aria-label="student level"
                >
                  {STUDENT_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={studentLevel === level}
                      aria-label={level}
                      onClick={() => setStudentLevel(level)}
                      className={`rounded-md border px-3 py-2 text-sm ${
                        studentLevel === level
                          ? "border-foreground bg-foreground/5"
                          : "border-border"
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {step === "persona-detail" && userType === "researcher" && (
              <div className="space-y-1.5">
                <Label htmlFor="jobRole">Job role</Label>
                <Input
                  id="jobRole"
                  type="text"
                  value={jobRole}
                  onChange={(e) => setJobRole(e.target.value)}
                  placeholder="Principal investigator"
                  required
                />
              </div>
            )}

            {step === "persona-detail" && userType === "industry" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="jobRole">Job role</Label>
                  <Input
                    id="jobRole"
                    type="text"
                    value={jobRole}
                    onChange={(e) => setJobRole(e.target.value)}
                    placeholder="Product lead"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="industry">Industry</Label>
                  <Input
                    id="industry"
                    type="text"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="Biotech"
                    required
                  />
                </div>
              </>
            )}

            {step === "persona-detail" && userType === "other" && (
              <div className="space-y-1.5">
                <Label htmlFor="personaOther">What describes you?</Label>
                <Input
                  id="personaOther"
                  type="text"
                  value={personaOther}
                  onChange={(e) => setPersonaOther(e.target.value)}
                  placeholder="Independent scholar"
                  required
                />
              </div>
            )}

            {step === "university" && (
              <div className="space-y-1.5">
                <Label htmlFor="university">University</Label>
                <div className="relative">
                  <Input
                    id="university"
                    type="text"
                    autoComplete="off"
                    value={university}
                    onChange={(e) => setUniversity(e.target.value)}
                    placeholder="Start typing a name..."
                    aria-autocomplete="list"
                    aria-expanded={uniSuggestions.length > 0}
                  />
                  {uniSuggestions.length > 0 && (
                    <ul
                      role="listbox"
                      aria-label="university suggestions"
                      className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md"
                    >
                      {uniSuggestions.map((u, i) => (
                        <li
                          key={`${u.name}-${u.country}-${i}`}
                          role="option"
                          aria-selected={false}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setUniversity(u.name);
                              setUniSuggestions([]);
                            }}
                            className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-sm hover:bg-accent"
                          >
                            <span>{u.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {u.country}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {step === "starter" && (
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
            )}

            {step === "invite" && (
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
            )}

            {step === "password" && (
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
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3 pt-6">
            <div className="flex w-full gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={loading || stepIndex === 0}
                onClick={handleBack}
              >
                Back
              </Button>
              {step === "password" ? (
                <Button type="submit" className="flex-1" disabled={loading}>
                  {loading ? "Creating account..." : "Create account"}
                </Button>
              ) : (
                <Button
                  type="button"
                  className="flex-1"
                  disabled={
                    loading ||
                    (step === "identity" && usernameAvail !== "available")
                  }
                  onClick={handleContinue}
                >
                  Continue
                </Button>
              )}
            </div>
            {step === "invite" && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={loading}
                onClick={handleWaitlist}
              >
                Join waitlist
              </Button>
            )}
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

function messageForAvail(s: UsernameAvail): string {
  switch (s) {
    case "taken":
      return "That username is taken";
    case "reserved":
      return "That username is reserved";
    case "invalid":
      return "Username must be 3-30 chars, lowercase a-z, 0-9 or -";
    case "checking":
      return "Checking username availability...";
    default:
      return "Username is required";
  }
}

function descriptionForStep(step: Step): string {
  switch (step) {
    case "identity":
      return "How should your account show up?";
    case "email":
      return "What email do you want to use?";
    case "persona":
      return "Which fits you best?";
    case "persona-detail":
      return "A bit more about you";
    case "university":
      return "Where do you study or research?";
    case "starter":
      return "Pick your starter";
    case "invite":
      return "Got an invite code?";
    case "password":
      return "Set your password";
  }
}

// Tiny 8x8 pixel-art tile. Uses a per-pokemon two-tone palette
// (transparent + accent) so we don't ship binary assets.
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

const PIXEL_PATTERNS: Record<"charmander" | "squirtle" | "bulbasaur", string> =
  {
    charmander:
      "00011000" +
      "00111100" +
      "01111110" +
      "01111110" +
      "11111111" +
      "11111111" +
      "01111110" +
      "00100100",
    squirtle:
      "00111100" +
      "01111110" +
      "11111111" +
      "11000011" +
      "11011011" +
      "11000011" +
      "01111110" +
      "00100100",
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
