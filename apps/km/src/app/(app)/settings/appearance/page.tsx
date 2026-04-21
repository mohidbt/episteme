import { getCurrentUserId } from "@/lib/session";
import { getUserPreferences } from "@/lib/preferences-server";
import { FontToggle } from "@/components/FontToggle";
import { RuledLinesToggle } from "@/components/RuledLinesToggle";

export default async function AppearanceSettingsPage() {
  const userId = (await getCurrentUserId())!;
  const prefs = await getUserPreferences(userId);

  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      <h1 className="font-display text-2xl mb-1">Appearance</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Customize how notes look while you write.
      </p>

      <div className="divide-y divide-border rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div>
            <div className="text-sm font-medium">Editor font</div>
            <div className="text-xs text-muted-foreground">
              Applies to note content only.
            </div>
          </div>
          <FontToggle initial={prefs.font} />
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div>
            <div className="text-sm font-medium">Ruled lines</div>
            <div className="text-xs text-muted-foreground">
              Show faint horizontal rules behind lines of text.
            </div>
          </div>
          <RuledLinesToggle initial={prefs.ruledLines} />
        </div>
      </div>
    </div>
  );
}
