// #69 — Friendly toast description for missing/invalid OpenRouter key.
// Renders a working link to /settings/agents so the user can fix it
// without leaving context.
import Link from "next/link";

export function renderOpenRouterKeyToastDescription() {
  return (
    <span>
      OpenRouter API key missing or invalid.{" "}
      <Link
        href="/settings/agents"
        className="underline underline-offset-2 hover:text-foreground"
      >
        Open Settings
      </Link>{" "}
      to configure.
    </span>
  );
}
