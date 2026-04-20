"use client"

import { useRouter } from "next/navigation"
import { signOut, useSession } from "@episteme/auth/client"
import { Button } from "@/components/ui/button"

export function UserMenu() {
  const { data: session, isPending } = useSession()
  const router = useRouter()

  if (isPending || !session) return null

  const displayName = session.user.name || session.user.email

  async function handleSignOut() {
    await signOut()
    router.push("/login")
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">{displayName}</span>
      <Button variant="outline" size="sm" onClick={handleSignOut}>
        Sign out
      </Button>
    </div>
  )
}
