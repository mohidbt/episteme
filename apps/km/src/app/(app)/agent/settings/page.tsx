export default function AgentSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-2xl mb-3">settings.json</h1>
      <textarea
        data-testid="agent-settings-editor"
        className="w-full min-h-[400px] rounded-md border border-border bg-background p-3 font-mono text-sm"
        placeholder="Agent settings (stub — Phase 0.9)"
      />
      <button
        type="button"
        className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm"
        disabled
      >
        Save (stub)
      </button>
    </div>
  );
}
