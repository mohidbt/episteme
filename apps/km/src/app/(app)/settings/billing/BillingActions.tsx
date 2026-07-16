"use client";

// GSD-141 — subscribe / manage CTAs for the billing page.
//
// Subscribe → POST /api/billing/checkout → hosted Stripe Checkout.
// Manage    → POST /api/billing/portal   → Stripe Customer Portal
//             (change plan, cancel, invoices).

import { useState } from "react";
import type { SubscriptionTier } from "@/lib/subscription-tiers";

const TIERS: Array<{ tier: SubscriptionTier; name: string; price: string; blurb: string }> = [
  { tier: "high", name: "High", price: "€2.50 / week", blurb: "High AI usage · 10 GB storage" },
  { tier: "max", name: "Max", price: "€5.00 / week", blurb: "Max AI usage · 100 GB storage" },
];

async function postJson(url: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { url?: string } | null;
  return data?.url ?? null;
}

export function BillingActions({
  activeTier,
}: {
  activeTier: SubscriptionTier | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(action: () => Promise<string | null>, key: string) {
    setBusy(key);
    setError(null);
    const url = await action();
    if (url) {
      // Hard nav to Stripe's hosted page — intentional external redirect.
      // eslint-disable-next-line react-hooks/immutability
      window.location.href = url;
      return;
    }
    setError("Something went wrong. Please try again.");
    setBusy(null);
  }

  if (activeTier) {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => go(() => postJson("/api/billing/portal"), "portal")}
          data-testid="billing-manage"
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {busy === "portal" ? "Opening…" : "Manage subscription"}
        </button>
        <p className="text-xs text-muted-foreground">
          Change plan, update payment method, view invoices, or cancel.
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {TIERS.map((t) => (
        <div
          key={t.tier}
          className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3"
        >
          <div>
            <div className="text-sm font-medium">
              {t.name} · {t.price}
            </div>
            <div className="text-xs text-muted-foreground">{t.blurb}</div>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              go(
                () => postJson("/api/billing/checkout", { tier: t.tier }),
                t.tier,
              )
            }
            data-testid={`billing-subscribe-${t.tier}`}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy === t.tier ? "…" : "Subscribe"}
          </button>
        </div>
      ))}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
