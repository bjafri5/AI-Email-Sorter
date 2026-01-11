"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useSyncContext } from "@/components/sync-context";

export function SyncButton() {
  const { isSyncing, progressText, isError, triggerSync } = useSyncContext();

  return (
    <div className="flex items-center gap-2">
      {progressText && (
        <span
          className={`hidden sm:inline text-xs ${isError ? "text-red-500" : "text-gray-500"}`}
        >
          {progressText}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button onClick={triggerSync} disabled={isSyncing}>
            {isSyncing ? "Syncing..." : "Sync Emails"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Fetch 10 new unread emails from each account and categorize them
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
