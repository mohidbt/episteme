import { getCurrentSession } from "@/lib/session";
import { getDefaultLibrary } from "@/lib/default-library";
import { listAllFolders } from "@/lib/folders-server";
import { getLibraryUsageBytes } from "@/lib/library-usage";
import {
  getRecentSpendUsd,
  OR_GUEST_SOFT_LIMIT_USD,
  OR_USER_SOFT_LIMIT_USD,
} from "@/lib/openrouter-usage";
import { ExportControls } from "@/components/ExportControls";
import { ImportControls } from "@/components/ImportControls";
import { DriveUsage } from "./DriveUsage";
import { OrUsage } from "./OrUsage";

export default async function DataSettingsPage() {
  const session = (await getCurrentSession())!;
  const userId = session.userId;
  const lib = await getDefaultLibrary(userId);
  const folders = lib ? await listAllFolders(lib.id, userId) : [];
  // One-library-per-user invariant (enforced at POST /api/libraries) means
  // "active library" === getDefaultLibrary. Multi-library users would need
  // a picker here; safe to revisit when the invariant lifts.
  // Round B + C usage panels run in parallel — independent reads, no waterfall.
  const [usage, orSpend] = await Promise.all([
    lib ? getLibraryUsageBytes(lib.id) : Promise.resolve(null),
    getRecentSpendUsd(
      session.isAnonymous ? null : userId,
      session.isAnonymous ? userId : null,
    ),
  ]);
  const orLimitUsd = session.isAnonymous
    ? OR_GUEST_SOFT_LIMIT_USD
    : OR_USER_SOFT_LIMIT_USD;

  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      <h1 className="font-display text-2xl mb-1">Data</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Export your library or import from a zip.
      </p>

      {!lib ? (
        <p className="text-sm text-muted-foreground">
          Create a library to manage your data.
        </p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-background">
          {usage && (
            <div className="px-4 py-4">
              <div className="text-sm font-medium mb-3">Storage</div>
              <DriveUsage usage={usage} />
            </div>
          )}
          <div className="px-4 py-4">
            <div className="text-sm font-medium mb-3">AI usage</div>
            <OrUsage
              usage={{
                totalUsd: orSpend.totalUsd,
                byModel: orSpend.byModel,
                isGuest: session.isAnonymous,
                limitUsd: orLimitUsd,
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-4">
            <div>
              <div className="text-sm font-medium">Export library</div>
              <div className="text-xs text-muted-foreground">
                Download a zip of your notes, papers, references, or everything.
              </div>
            </div>
            <ExportControls libraryId={lib.id} />
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-4">
            <div>
              <div className="text-sm font-medium">Import from file</div>
              <div className="text-xs text-muted-foreground">
                {session.isAnonymous
                  ? "Sign in to import notes, papers, and references."
                  : "Upload a .zip previously exported from Episteme, or an Episteme compatible single file."}
              </div>
            </div>
            {session.isAnonymous ? (
              <a
                href="/sign-up"
                data-testid="settings-import-signup-cta"
                className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Sign up to import
              </a>
            ) : (
              <ImportControls libraryId={lib.id} folders={folders} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
