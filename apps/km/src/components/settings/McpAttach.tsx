"use client";

import * as React from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import type { AttachedMcp } from "./PermissionsForm";

export function McpAttach({
  attachedMcps,
  onChange,
}: {
  attachedMcps: AttachedMcp[];
  onChange: (next: AttachedMcp[]) => void;
}) {
  function disconnect(idx: number) {
    onChange(attachedMcps.filter((_, i) => i !== idx));
  }

  return (
    <div className="flex flex-col gap-4">
      {attachedMcps.length === 0 ? (
        <Empty>
          <EmptyTitle>No MCPs attached</EmptyTitle>
          <EmptyDescription>
            Attach an MCP to expose its tools to your agents.
          </EmptyDescription>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
          {attachedMcps.map((mcp, i) => (
            <li
              key={`${mcp.name}-${i}`}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{mcp.name}</span>
                  <Badge variant="secondary">connected</Badge>
                </div>
                {mcp.account && (
                  <div className="text-xs text-muted-foreground">{mcp.account}</div>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label={`actions for ${mcp.name}`}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled>Reauth (coming soon)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => disconnect(i)}>
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button variant="outline" size="sm" disabled aria-label="Attach MCP">
          <Plus className="size-4" />
          Attach MCP (coming soon)
        </Button>
      </div>
    </div>
  );
}
