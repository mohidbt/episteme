import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@episteme/auth/server";
import { ApiKeysManager } from "@/components/settings/api-keys-manager";

export default async function ApiKeysPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-semibold mb-6">API Keys</h1>
      <ApiKeysManager />
    </div>
  );
}
