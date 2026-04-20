"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

type ProviderType = "llm" | "voice" | "ocr" | "references";
type StorageMode = "cloud" | "browser_only";

interface ApiKey {
  id: number;
  providerType: ProviderType;
  providerName: string;
  keyPreview: string;
  isValid: boolean | null;
  storageMode: StorageMode;
  createdAt: string;
}

const DEFAULT_PROVIDER_NAMES: Record<ProviderType, string> = {
  llm: "openrouter",
  voice: "elevenlabs",
  ocr: "chandra",
  references: "semantic-scholar",
};

const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  llm: "LLM",
  voice: "Voice",
  ocr: "OCR",
  references: "References",
};

const BADGE_COLORS: Record<ProviderType, string> = {
  llm: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  voice: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  ocr: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  references: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

export function ApiKeysManager() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [providerType, setProviderType] = useState<ProviderType>("llm");
  const [providerName, setProviderName] = useState("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function fetchKeys() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/api-keys");
      if (!res.ok) throw new Error("Failed to load API keys");
      const data = (await res.json()) as { keys: ApiKey[] };
      setKeys(data.keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchKeys();
  }, []);

  function handleProviderTypeChange(value: ProviderType) {
    setProviderType(value);
    setProviderName(DEFAULT_PROVIDER_NAMES[value]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerType, providerName, apiKey }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save API key");
      }
      setApiKey("");
      await fetchKeys();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/settings/api-keys?keyId=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete API key");
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setDeletingId(null);
    }
  }

  // Detect if Chandra key is configured
  const hasChandraKey = keys.some(k => k.providerType === "ocr" && k.providerName === "chandra");

  return (
    <div className="space-y-8">
      {/* Chandra Key Missing Banner */}
      {!loading && !hasChandraKey && (
        <Alert variant="default" data-testid="chandra-missing-banner">
          <Info className="size-4" />
          <AlertDescription>
            Configure Chandra key to enable Smart Explanations on figures and formulas.
          </AlertDescription>
        </Alert>
      )}

      {/* Add Key Form */}
      <Card className="p-6">
        <h2 className="text-lg font-medium mb-4">Add API Key</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="providerType">Provider Type</Label>
              <select
                id="providerType"
                value={providerType}
                onChange={(e) => handleProviderTypeChange(e.target.value as ProviderType)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="llm">LLM</option>
                <option value="voice">Voice</option>
                <option value="ocr">OCR</option>
                <option value="references">Semantic Scholar</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="providerName">Provider Name</Label>
              <Input
                id="providerName"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder="e.g. openrouter"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your API key here"
              required
            />
            {providerType === "references" && (
              <p className="text-xs text-muted-foreground">
                Semantic Scholar API key (optional — increases rate limits).{" "}
                <a
                  href="https://www.semanticscholar.org/product/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Request one here.
                </a>
              </p>
            )}
          </div>
          {formError && (
            <p className="text-sm text-destructive">{formError}</p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Save Key"}
          </Button>
        </form>
      </Card>

      {/* Existing Keys */}
      <div>
        <h2 className="text-lg font-medium mb-4">Saved Keys</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API keys saved yet.</p>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <Card key={key.id} className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${BADGE_COLORS[key.providerType]}`}
                  >
                    {PROVIDER_TYPE_LABELS[key.providerType]}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{key.providerName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{key.keyPreview}</p>
                  </div>
                  {key.isValid !== null && (
                    <span
                      className={`text-xs shrink-0 ${key.isValid ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
                    >
                      {key.isValid ? "Valid" : "Invalid"}
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(key.id)}
                  disabled={deletingId === key.id}
                  className="shrink-0 text-destructive hover:text-destructive"
                >
                  {deletingId === key.id ? "Removing..." : "Remove"}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
