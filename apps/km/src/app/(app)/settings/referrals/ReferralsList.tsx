"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReferralCodeRow } from "@/lib/referral-codes";

export function ReferralsList({ codes }: { codes: ReferralCodeRow[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500);
    } catch {
      toast.error("Could not copy");
    }
  }

  if (codes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="referrals-empty">
        Your invite codes will appear here once your account is set up.
      </p>
    );
  }

  return (
    <ul
      className="divide-y divide-border rounded-lg border border-border bg-background"
      data-testid="referrals-list"
    >
      {codes.map((row) => {
        const redeemed = Boolean(row.consumedByUserId);
        const status = redeemed
          ? row.consumedByUsername
            ? `Redeemed by @${row.consumedByUsername}`
            : "Redeemed"
          : "Available";
        return (
          <li
            key={row.code}
            className="flex items-center justify-between gap-3 px-4 py-3"
            data-testid={`referral-row-${row.code}`}
          >
            <div className="min-w-0 space-y-1">
              <code className="block truncate font-mono text-sm text-foreground">
                {row.code}
              </code>
              <Badge
                variant={redeemed ? "secondary" : "default"}
                data-testid={`referral-status-${row.code}`}
              >
                {status}
              </Badge>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={redeemed}
              onClick={() => copy(row.code)}
              aria-label={`Copy ${row.code}`}
              data-testid={`referral-copy-${row.code}`}
            >
              {copied === row.code ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              <span>Copy</span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
