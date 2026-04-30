import { getCurrentUserId } from "@/lib/session";
import { getDefaultLibrary } from "@/lib/default-library";
import { listAllFolders } from "@/lib/folders-server";
import { ExportControls } from "@/components/ExportControls";
import { ImportControls } from "@/components/ImportControls";

export default async function DataSettingsPage() {
  const userId = (await getCurrentUserId())!;
  const lib = await getDefaultLibrary(userId);
  const folders = lib ? await listAllFolders(lib.id, userId) : [];

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
                Upload a .zip previously exported from Episteme, or a single .md note.
              </div>
            </div>
            <ImportControls libraryId={lib.id} folders={folders} />
          </div>
        </div>
      )}
    </div>
  );
}
